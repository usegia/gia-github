import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import {
  platformEnvironment,
  readJson,
  requireText,
  root,
  run,
  source,
  state,
  writePrivateJson,
} from "./common.mjs";

const command = process.argv[2];
if (!["start", "stop"].includes(command))
  throw new Error("Usage: node scripts/gia/runtime.mjs start|stop");
if (Number(process.versions.node.split(".")[0]) < 26)
  throw new Error("Gia Runtime requires Node 26 or newer");
const runtimeRoot = source("gia-runtime");
const receiptPath = path.join(state, "process.json");
const configPath = path.join(state, "signing.json");
const logPath = path.join(state, "runtime.log");
const port = Number(process.env.GIA_RUNTIME_PORT ?? "8798");
const apiUrl = `http://127.0.0.1:${port}`;
const harnessProfileId = "terra-openai-none";
const localDebug = process.env.GIA_RUNTIME_LOCAL_DEBUG ?? "0";
if (!["0", "1"].includes(localDebug)) throw new Error("GIA_RUNTIME_LOCAL_DEBUG must be 0 or 1");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid Runtime port");
const receipt = await readJson(receiptPath).catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
const healthy = async () =>
  fetch(`${apiUrl}/v1/health`, { signal: AbortSignal.timeout(1000) }).then(
    (response) => response.ok,
    () => false,
  );
function owned(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.pid) ||
    value.runtimeRoot !== runtimeRoot ||
    value.apiUrl !== apiUrl
  )
    return false;
  try {
    return execFileSync("ps", ["-p", String(value.pid), "-o", "command="], {
      encoding: "utf8",
    }).includes(path.join(runtimeRoot, "src/main.ts"));
  } catch {
    return false;
  }
}
if (command === "stop") {
  if (!receipt) {
    if (await healthy()) throw new Error("Refusing to stop an unowned Runtime");
  } else {
    if (!owned(receipt)) throw new Error("Runtime process ownership could not be verified");
    process.kill(receipt.pid, "SIGTERM");
    for (let attempt = 0; attempt < 100 && owned(receipt); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (owned(receipt))
      throw new Error("Runtime did not stop within 10 seconds; process was not force-killed");
    await rm(receiptPath);
  }
  console.log("Local Runtime stopped; registry data preserved.");
} else {
  const sourceReceipt = await readJson(path.join(root, ".gia-sources.json"));
  const expectedRevision = sourceReceipt.sources.find(
    (entry) => entry.directory === "gia-runtime",
  )?.revision;
  const runtimeRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: runtimeRoot,
    encoding: "utf8",
  }).trim();
  const sourceChanges = execFileSync("git", ["status", "--porcelain"], {
    cwd: runtimeRoot,
    encoding: "utf8",
  }).trim();
  if (runtimeRevision !== expectedRevision || sourceChanges)
    throw new Error("Runtime source must be clean at the pinned revision before startup");
  if (await healthy()) {
    if (!owned(receipt))
      throw new Error("A Runtime is already listening but is not owned by this project");
    if (
      receipt.harnessProfileId !== harnessProfileId ||
      receipt.runtimeRevision !== runtimeRevision
    )
      throw new Error("Runtime policy or source changed; stop the owned process before restarting");
    console.log(`Owned Runtime is already running at ${apiUrl}`);
  } else {
    if (owned(receipt))
      throw new Error("Owned Runtime is running but unhealthy; inspect its private log");
    await mkdir(state, { recursive: true, mode: 0o700 });
    const signing = await readJson(configPath).catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      const { privateKey } = generateKeyPairSync("ed25519");
      const value = {
        keyId: "gia-github-local-v1",
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
      };
      await writePrivateJson(configPath, value);
      return value;
    });
    const env = {
      ...platformEnvironment(),
      GIA_RUNTIME_DATABASE_URL:
        process.env.GIA_RUNTIME_DATABASE_URL ??
        "postgresql://gia_github:local-development-only@127.0.0.1:55448/gia_github_runtime",
      GIA_RUNTIME_HOST: "127.0.0.1",
      PORT: String(port),
      GIA_RUNTIME_PREPARE: "enabled",
      GIA_RUNTIME_TICKET_SIGNING_KEY_ID: requireText(signing.keyId, "Signing key id"),
      GIA_RUNTIME_TICKET_SIGNING_PRIVATE_KEY_PEM: requireText(signing.privateKeyPem, "Signing key"),
      OPENROUTER_API_KEY: requireText(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY"),
      GIA_RUNTIME_REQUEST_TIMEOUT_MS: "180000",
      GIA_RUNTIME_HEADERS_TIMEOUT_MS: "181000",
      GIA_RUNTIME_DATABASE_STATEMENT_TIMEOUT_MS: "185000",
      GIA_RUNTIME_DATABASE_LOCK_TIMEOUT_MS: "10000",
      GIA_RUNTIME_SQL_REUSE: "off",
      GIA_RUNTIME_DEBUG: localDebug === "1" ? "enabled" : "off",
      GIA_RUNTIME_DEBUG_CAPTURE_GRANTS: localDebug === "1" ? "local" : "off",
      GIA_RUNTIME_OBSERVABILITY: "off",
    };
    await run(process.execPath, ["scripts/migrate.ts"], { cwd: runtimeRoot, env });
    const log = await open(logPath, "a", 0o600);
    const child = spawn(process.execPath, [path.join(runtimeRoot, "src/main.ts")], {
      cwd: runtimeRoot,
      env,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await log.close();
    if (child.pid === undefined) throw new Error("Runtime could not start");
    child.unref();
    const started = {
      pid: child.pid,
      runtimeRoot,
      runtimeRevision,
      harnessProfileId,
      apiUrl,
    };
    await writePrivateJson(receiptPath, started);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!owned(started)) break;
      if (await healthy()) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) {
      if (owned(started)) {
        process.kill(child.pid, "SIGTERM");
        for (let attempt = 0; attempt < 100 && owned(started); attempt++)
          await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!owned(started)) await rm(receiptPath, { force: true });
      throw new Error(
        `Runtime failed to become ready. Inspect ${path.relative(root, logPath)} privately.`,
      );
    }
    console.log(`Local Gia Runtime ready at ${apiUrl}`);
  }
}
