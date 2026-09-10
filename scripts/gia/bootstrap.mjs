import { execFileSync } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { root, sources, source, readJson, run } from "./common.mjs";

if (Number(process.versions.node.split(".")[0]) < 26) throw new Error("Gia bootstrap requires Node 26 or newer");
const receipt = await readJson(`${root}/.gia-sources.json`);
if (receipt.version !== 1 || !Array.isArray(receipt.sources)) throw new Error("Unsupported Gia source receipt");
await mkdir(sources, { recursive: true });
for (const entry of receipt.sources) {
  if (!/^gia-(core|sdk-typescript|runtime)$/.test(entry.directory) || !/^usegia\/gia-[a-z-]+$/.test(entry.repository) || !/^[a-f0-9]{40}$/.test(entry.revision)) {
    throw new Error("Invalid Gia source receipt");
  }
  const directory = source(entry.directory);
  const exists = await access(directory).then(() => true, () => false);
  if (!exists) {
    await run("git", ["clone", "--no-checkout", `https://github.com/${entry.repository}.git`, directory]);
    await run("git", ["checkout", "--detach", entry.revision], { cwd: directory });
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: directory, encoding: "utf8" }).trim();
  if (head !== entry.revision || dirty) throw new Error(`${entry.directory} must be clean at its receipt revision; bootstrap never resets an existing checkout`);
  console.log(`${entry.directory}: ${head}`);
}
await run("pnpm", ["install", "--frozen-lockfile"], { cwd: source("gia-core") });
await run("pnpm", ["build"], { cwd: source("gia-core") });
await run("pnpm", ["install", "--frozen-lockfile"], { cwd: source("gia-sdk-typescript") });
await run("npm", ["ci"], { cwd: source("gia-runtime") });
console.log("Pinned Gia dependencies ready. Private source access remains required.");
