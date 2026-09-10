import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist", ".turbo"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(?:ts|tsx|mjs)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.push(full);
  }
}
await walk(path.join(root, "apps"));
await walk(path.join(root, "packages"));
const graph = new Map();
const violations = new Set();
for (const file of files) {
  const source = await readFile(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) imports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
      else
        violations.add(
          `${path.relative(root, file)}: computed dynamic imports need an explicit boundary review`,
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const client = ast.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client",
  );
  graph.set(file, { imports, client });
  if (file.startsWith(path.join(root, "packages"))) {
    for (const imported of imports) {
      const destination = path.resolve(path.dirname(file), imported);
      if (
        imported.startsWith("@gia-github/web") ||
        imported.startsWith("@gia-github/worker") ||
        (imported.startsWith(".") && destination.startsWith(path.join(root, "apps")))
      ) {
        violations.add(
          `${path.relative(root, file)}: shared packages cannot import applications (${imported})`,
        );
      }
    }
  }
}
function localImport(file, specifier) {
  if (specifier === "@gia-github/search/contracts")
    return path.join(root, "packages/search/src/contracts.ts");
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/")
    ? path.join(root, "apps/web/src", specifier.slice(2))
    : path.resolve(path.dirname(file), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => graph.has(candidate)) ?? null;
}
function inspectClient(file, visited = new Set()) {
  if (visited.has(file)) return;
  visited.add(file);
  for (const specifier of graph.get(file)?.imports ?? []) {
    if (
      specifier.startsWith("node:") ||
      /^(?:pg|pg-boss|drizzle-orm|dotenv|server-only)(?:\/|$)/.test(specifier) ||
      specifier.startsWith("@gia/") ||
      specifier.startsWith("@gia-core/") ||
      specifier.startsWith("@gia-github/db") ||
      specifier === "@gia-github/search/server"
    ) {
      violations.add(
        `${path.relative(root, file)}: browser import reaches server dependency ${specifier}`,
      );
    }
    const resolved = localImport(file, specifier);
    if (resolved) inspectClient(resolved, visited);
  }
}
for (const [file, data] of graph) if (data.client) inspectClient(file);
if (violations.size > 0) {
  process.stderr.write(`${[...violations].join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Package and browser boundaries checked across ${files.length} source files.\n`,
  );
}
