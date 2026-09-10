import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "dotenv";
import { expect, it } from "vitest";
import { z } from "zod";

const execute = promisify(execFile);
config({ quiet: true });

it("cleans a failed real Runtime startup without stopping the process occupying its port", async () => {
  expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(26);
  z.string().min(1).parse(process.env.OPENROUTER_API_KEY);
  const project = await mkdtemp(path.join(tmpdir(), "gia-github-runtime-"));
  const occupant = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    occupant.once("error", reject);
    occupant.listen(0, "127.0.0.1", resolve);
  });
  const address = occupant.address();
  if (!address || typeof address === "string") throw new Error("TCP port was not allocated");
  const env = { ...process.env, GIA_RUNTIME_PORT: String(address.port) };
  try {
    await mkdir(path.join(project, "scripts/gia"), { recursive: true });
    await mkdir(path.join(project, ".deps/gia-sources"), { recursive: true });
    for (const filename of ["runtime.mjs", "common.mjs"])
      await copyFile(
        path.resolve("scripts/gia", filename),
        path.join(project, "scripts/gia", filename),
      );
    await copyFile(path.resolve(".gia-sources.json"), path.join(project, ".gia-sources.json"));
    await symlink(
      path.resolve(".deps/gia-sources/gia-runtime"),
      path.join(project, ".deps/gia-sources/gia-runtime"),
      "dir",
    );
    const invalidPolicy: unknown = await execute(
      process.execPath,
      ["scripts/gia/runtime.mjs", "start"],
      {
        cwd: project,
        env: { ...env, GIA_RUNTIME_HARNESS_PROFILE: "unregistered-profile" },
        timeout: 15_000,
      },
    ).catch((error: unknown) => error);
    const invalid = z.object({ code: z.literal(1), stderr: z.string() }).parse(invalidPolicy);
    expect(invalid.stderr).toContain("unknown Harness profile");
    await expect(
      readFile(path.join(project, ".gia/local-runtime/signing.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const failure: unknown = await execute(process.execPath, ["scripts/gia/runtime.mjs", "start"], {
      cwd: project,
      env,
      timeout: 30_000,
    }).then(
      () => {
        throw new Error("Runtime started on an occupied port");
      },
      (error: unknown) => error,
    );
    const rejected = z.object({ code: z.literal(1), stderr: z.string() }).parse(failure);
    expect(rejected.stderr).toContain("Runtime failed to become ready");
    const log = await readFile(path.join(project, ".gia/local-runtime/runtime.log"), "utf8");
    expect(log).toContain("EADDRINUSE");
    await expect(
      readFile(path.join(project, ".gia/local-runtime/process.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(occupant.listening).toBe(true);
    const stopped = await execute(process.execPath, ["scripts/gia/runtime.mjs", "stop"], {
      cwd: project,
      env,
      timeout: 15_000,
    });
    expect(stopped.stdout).toContain("registry data preserved");
    expect(occupant.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupant.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(project, { recursive: true, force: true });
  }
});
