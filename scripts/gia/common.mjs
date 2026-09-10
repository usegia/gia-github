import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const sources = path.join(root, ".deps/gia-sources");
export const state = path.join(root, ".gia/local-runtime");
export const source = (name) => path.join(sources, name);
export const sourceModule = (repository, relative) =>
  import(pathToFileURL(path.join(source(repository), relative)).href);
export const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));

export async function writePrivateJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, filename);
}

export async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    stdio: "inherit",
    ...options,
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(command)} failed (${signal ?? code})`)),
    );
  });
}

export function platformEnvironment() {
  const result = {};
  for (const name of [
    "HOME",
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SYSTEMROOT",
    "WINDIR",
    "SSH_AUTH_SOCK",
  ]) {
    if (process.env[name] !== undefined) result[name] = process.env[name];
  }
  return result;
}

export function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
