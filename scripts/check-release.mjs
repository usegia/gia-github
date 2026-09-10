import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const sensitiveValues = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      /(?:TOKEN|API_KEY|PRIVATE_KEY|PASSWORD|SECRET)$/.test(name) && value && value.length >= 20,
  )
  .map(([, value]) => value);
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
