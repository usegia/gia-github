import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import {
  platformEnvironment,
  readJson,
  requireText,
  root,
  run,
  source,
  sourceModule,
  writePrivateJson,
} from "./common.mjs";

const command = process.argv[2];
if (!["init", "refresh", "publish", "profile", "authority"].includes(command))
  throw new Error("Usage: node scripts/gia/project.mjs init|refresh|publish|profile|authority");
const projectDirectory = path.resolve(process.env.GIA_PROJECT_DIR ?? root);
const runtimeUrl = process.env.GIA_API_URL ?? "http://127.0.0.1:8798";
const profileId = process.env.GIA_ACTIVE_PROFILE ?? "github-dev";
const filename = (...parts) => path.join(projectDirectory, ...parts);
if (command === "init" || command === "refresh" || command === "publish") {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(filename(".gia"), { recursive: true, mode: 0o700 });
  const env = {
    ...platformEnvironment(),
    DATABASE_URL: requireText(
      process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL,
      "DATABASE_ADMIN_URL or DATABASE_URL",
    ),
    GIA_API_URL: runtimeUrl,
    ...(command !== "publish"
      ? {
          OPENROUTER_API_KEY: requireText(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY"),
          GIA_ENRICH_DUAL_OPENROUTER: "1",
        }
      : {}),
  };
  const args =
    command === "init"
      ? [
          "init",
          "--name",
          "gia-github",
          "--tables-file",
          path.join(root, "config/gia-tables.txt"),
          "--environment",
          "dev",
          "--enrich",
          "--yes",
        ]
      : command === "refresh"
        ? ["refresh", "--environment", "dev", "--force-harvest", "--enrich", "--yes"]
        : ["publish", "--environment", "dev"];
  const logPath = filename(".gia", `${command}.log`);
  const log = await open(logPath, "a", 0o600);
  try {
    await run(
      process.execPath,
      [
        "--experimental-strip-types",
        path.join(source("gia-sdk-typescript"), "packages/cli/bin/gia.mjs"),
        ...args,
      ],
      { cwd: projectDirectory, env, stdio: ["ignore", log.fd, log.fd] },
    );
  } catch {
    throw new Error(
      `Gia ${command} failed; inspect the private .gia/${command}.log. It may contain credentials.`,
    );
  } finally {
    await log.close();
  }
  console.log(`Gia ${command} completed. Detailed output stays in .gia/${command}.log.`);
} else {
  const sdk = await sourceModule("gia-sdk-typescript", "packages/sdk/src/index.ts");
  const docs = await sdk.projectLocalAuthorityReader(sdk.resolveProjectLayout(projectDirectory))(
    AbortSignal.timeout(30_000),
  );
  const world = await readJson(filename("gia/generated/effective-world.json"));
  const entries = Object.entries(world.entities).filter(
    ([, value]) => value.collection === "github.accounts",
  );
  if (
    entries.length !== 1 ||
    entries[0][1].identity?.kind !== "field-tuple" ||
    entries[0][1].identity.fields.join(",") !== "id"
  ) {
    throw new Error(
      "The reviewed World must contain one github.accounts entity with the id identity",
    );
  }
  const accountsEntityId = entries[0][0];
  if (command === "authority") {
    const { compilerBindingBytes, ...fields } = docs;
    await writePrivateJson(filename("gia/client-authority.json"), {
      version: 1,
      ...fields,
      accountsEntityId,
      compilerBindingBase64: Buffer.from(compilerBindingBytes).toString("base64"),
    });
    console.log("Wrote gia/client-authority.json from reviewed SDK authority documents.");
  } else {
    const credentials = await readJson(filename(".gia/credentials.json"));
    const apiKey = requireText(process.env.GIA_API_KEY || credentials.apiKey, "Gia API key");
    if (credentials.projectId !== docs.projectId || docs.projectId !== docs.worldId)
      throw new Error("Gia project authority does not agree");
    const result = await sourceModule("gia-core", "packages/contracts/dist/result/index.js");
    const target = await sourceModule("gia-core", "packages/contracts/dist/target/index.js");
    const wire = await sourceModule("gia-core", "packages/contracts/dist/wire/index.js");
    const api = await sourceModule("gia-core", "packages/runtime-api/dist/index.js");
    const engineMajor = Math.floor(Number(docs.postgresStoreVersion) / 10000);
    if (![16, 17].includes(engineMajor)) throw new Error("Gia PostgreSQL target must be 16 or 17");
    const profile = {
      profileId,
      worldId: docs.worldId,
      snapshot: { type: "snapshotId", snapshotId: docs.candidateSnapshotId },
      target: {
        dialect: "postgres",
        targetSha: target.targetContextSha({
          dialect: "postgres",
          snapshotSha: docs.candidateSnapshotId,
          capabilityProfileSha: result.POSTGRES_CAPABILITY_PROFILE.identitySha,
          engineMajor,
        }),
        identities: target.currentPhysicalIdentities(result.POSTGRES_CAPABILITY_PROFILE),
      },
      defaultEntity: accountsEntityId,
      ticketTtlMs: 600_000,
      reportPolicyDefaults: { proofDisclosure: "included" },
    };
    const identity = (kind) => ({
      id: `github.public.${kind}`,
      contentSha: wire.shaOf({ projectId: docs.projectId, kind }),
    });
    const request = async (method, route, body, allowMissing = false) => {
      const response = await fetch(new URL(route, runtimeUrl), {
        method,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (allowMissing && response.status === 404) return undefined;
      const value = await response.json();
      if (!response.ok)
        throw new Error(`Runtime profile request failed with HTTP ${response.status}`);
      return value;
    };
    const operation = (kind, value) =>
      `github-${kind}-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40)}`;
    const putBody = {
      profile,
      tenant: identity("tenant"),
      principal: identity("principal"),
      rowPolicy: identity("row-policy"),
      reportPolicyId: "github.public.report-policy",
      nonceBytes: 32,
    };
    const put = api.parsePutServingProfileRevisionResponse(
      await request("POST", "/v1/serving-profile-revisions", {
        operationId: operation("put", putBody),
        ...putBody,
      }),
    );
    const previousValue = await request(
      "GET",
      api.getCurrentServingProfilePath({ profileId }),
      undefined,
      true,
    );
    const previous =
      previousValue === undefined
        ? null
        : api.parseGetCurrentServingProfileResponse(previousValue).revision.revisionId;
    if (previous !== put.revision.revisionId) {
      const move = { profileId, revisionId: put.revision.revisionId, expectedRevisionId: previous };
      api.parseMoveServingProfileHeadResponse(
        await request("POST", "/v1/serving-profile-heads/move", {
          operationId: operation("move", move),
          ...move,
        }),
      );
    }
    console.log(
      JSON.stringify({
        profileId,
        revisionId: put.revision.revisionId,
        snapshotId: docs.candidateSnapshotId,
        accountsEntityId,
      }),
    );
  }
}
