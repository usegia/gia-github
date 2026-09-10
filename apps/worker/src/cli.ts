import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "@gia-github/db";
import { config as loadEnvironment } from "dotenv";
import { z } from "zod";
import { collectGitHub, seedSchema } from "./collector.ts";
import { enrichRepositories } from "./enrich-database.ts";
import { createGitHubClient } from "./github.ts";
import { importCaptureDirectory } from "./importer.ts";
import { startWorker } from "./jobs.ts";

const directory = process.env.INIT_CWD ?? process.cwd();
loadEnvironment({ path: resolve(directory, ".env"), quiet: true });
const { positionals, values } = parseArgs({
  args: process.argv.slice(2).filter((argument) => argument !== "--"),
  allowPositionals: true,
  options: {
    capture: { type: "string" },
    live: { type: "boolean" },
    seed: { type: "string", default: "config/seed-manifest.json" },
    "max-requests": { type: "string", default: "350" },
    "max-model-calls": { type: "string", default: "5" },
    "no-schedule": { type: "boolean" },
  },
});
const command = positionals[0] ?? "ingest";
const databaseUrl = z.url().parse(process.env.DATABASE_URL);

async function main() {
  if (command === "work") {
    const seed = seedSchema.parse(
      JSON.parse(await readFile(resolve(directory, values.seed), "utf8")),
    );
    const worker = await startWorker({
      databaseUrl,
      githubToken: z.string().min(1).parse(process.env.GIA_GITHUB_TOKEN),
      seed,
      maximumRequests: Number(values["max-requests"]),
      schedule: !values["no-schedule"],
    });
    let stopping = false;
    const stop = () => {
      if (!stopping) {
        stopping = true;
        void worker.stop().catch(() => {
          process.exitCode = 1;
        });
      }
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    process.stdout.write("GitHub ingestion worker is ready.\n");
    return;
  }
  const database = createDatabase({ connectionString: databaseUrl });
  try {
    if (command === "enrich") {
      const result = await enrichRepositories(database, {
        apiKey: z.string().min(1).parse(process.env.OPENAI_API_KEY),
        model: process.env.GIA_GITHUB_ENRICHMENT_MODEL ?? "gpt-4.1-mini",
        maximumCalls: z.coerce.number().int().min(1).max(100).parse(values["max-model-calls"]),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (command !== "ingest") throw new Error("Command must be ingest, work, or enrich");
    if (values.capture && values.live) throw new Error("Choose either --capture or --live");
    if (values.live) {
      const seed = seedSchema.parse(
        JSON.parse(await readFile(resolve(directory, values.seed), "utf8")),
      );
      const client = createGitHubClient({
        token: z.string().min(1).parse(process.env.GIA_GITHUB_TOKEN),
        maximumRequests: Number(values["max-requests"]),
      });
      process.stdout.write(`${JSON.stringify(await collectGitHub(database, client, seed))}\n`);
    } else {
      const capture = resolve(directory, values.capture ?? "fixtures/github");
      process.stdout.write(`${JSON.stringify(await importCaptureDirectory(database, capture))}\n`);
    }
  } finally {
    await database.close();
  }
}
main().catch((error: unknown) => {
  // Avoid printing provider/driver objects, request headers, or connection URLs.
  process.stderr.write(
    error instanceof z.ZodError
      ? "Invalid worker input or source response.\n"
      : "Worker command failed. Check source coverage and database connectivity.\n",
  );
  process.exitCode = 1;
});
