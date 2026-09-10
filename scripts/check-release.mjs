import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ quiet: true });

const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
if (resolve(repository) !== resolve(process.cwd()))
  throw new Error("Run the release check from this repository's root");

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
if (tracked.length === 0)
  throw new Error("Release check requires a nonempty staged file inventory");
const sensitiveValues = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      /(?:TOKEN|API_KEY|PRIVATE_KEY|PASSWORD|SECRET)$/.test(name) && value && value.length >= 20,
  )
  .map(([, value]) => value);
const credentials = await readFile(".gia/credentials.json", "utf8").catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
if (credentials !== undefined) {
  const apiKey = JSON.parse(credentials).apiKey;
  if (typeof apiKey !== "string" || apiKey.length < 20)
    throw new Error("Local Gia credentials have an invalid API key");
  sensitiveValues.push(apiKey);
}
const problems = [];
for (const file of tracked) {
  if (
    /^(?:\.deps|\.gia|\.data|node_modules|\.worktrees)\//.test(file) ||
    (/^\.env(?:\.|$)/.test(file) && file !== ".env.example")
  ) {
    problems.push(`${file}: private state or dependency is tracked`);
    continue;
  }
  if ((await lstat(file)).isSymbolicLink()) {
    problems.push(`${file}: tracked symlink needs a distribution review`);
    continue;
  }
  const content = await readFile(file, "utf8");
  if (sensitiveValues.some((value) => content.includes(value)))
    problems.push(`${file}: contains a credential available to this process`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content))
    problems.push(`${file}: contains private key material`);
}
if (problems.length) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release file hygiene checked for ${tracked.length} tracked files. No available credentials or private dependency trees found.\n`,
  );
}
