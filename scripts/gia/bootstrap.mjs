import { execFileSync } from "node:child_process";
import { access, cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJson, root, run, source, sources } from "./common.mjs";

if (Number(process.versions.node.split(".")[0]) < 26)
  throw new Error("Gia bootstrap requires Node 26 or newer");
const receipt = await readJson(`${root}/.gia-sources.json`);
if (receipt.version !== 1 || !Array.isArray(receipt.sources))
  throw new Error("Unsupported Gia source receipt");
await mkdir(sources, { recursive: true });
for (const entry of receipt.sources) {
  if (
    !/^gia-(core|sdk-typescript|runtime)$/.test(entry.directory) ||
    !/^usegia\/gia-[a-z-]+$/.test(entry.repository) ||
    !/^[a-f0-9]{40}$/.test(entry.revision)
  ) {
    throw new Error("Invalid Gia source receipt");
  }
  const directory = source(entry.directory);
  const exists = await access(directory).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await run("git", [
      "clone",
      "--no-checkout",
      `https://github.com/${entry.repository}.git`,
      directory,
    ]);
    await run("git", ["checkout", "--detach", entry.revision], { cwd: directory });
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  if (head !== entry.revision || dirty)
    throw new Error(
      `${entry.directory} must be clean at its receipt revision; bootstrap never resets an existing checkout`,
    );
  console.log(`${entry.directory}: ${head}`);
}
await run("pnpm", ["install", "--frozen-lockfile"], { cwd: source("gia-core") });
await run("pnpm", ["build"], { cwd: source("gia-core") });
await run("pnpm", ["install", "--frozen-lockfile"], { cwd: source("gia-sdk-typescript") });
await run("npm", ["ci"], { cwd: source("gia-runtime") });
await run("pnpm", ["exec", "tsc", "-b", "packages/client"], { cwd: source("gia-sdk-typescript") });
const clientPackage = path.join(root, ".deps/gia-client");
await mkdir(clientPackage, { recursive: true });
await rm(path.join(clientPackage, "dist"), { recursive: true, force: true });
await cp(
  path.join(source("gia-sdk-typescript"), "packages/client/dist"),
  path.join(clientPackage, "dist"),
  { recursive: true },
);
await writeFile(
  path.join(clientPackage, "package.json"),
  `${JSON.stringify(
    {
      name: "@gia/client",
      version: "0.0.0",
      private: true,
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      dependencies: {
        "@gia-core/contracts": "link:../gia-sources/gia-core/packages/contracts",
        "@gia-core/runtime-api": "link:../gia-sources/gia-core/packages/runtime-api",
      },
    },
    null,
    2,
  )}\n`,
);
await rm(path.join(clientPackage, "node_modules"), { recursive: true, force: true });
await symlink(
  path.join(source("gia-sdk-typescript"), "packages/client/node_modules"),
  path.join(clientPackage, "node_modules"),
  "dir",
);
console.log("Pinned Gia dependencies ready. Private source access remains required.");
