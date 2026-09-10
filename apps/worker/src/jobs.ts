import { createDatabase } from "@gia-github/db";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { collectGitHub, seedSchema } from "./collector.ts";
import { createGitHubClient } from "./github.ts";

export const SYNC_QUEUE = "github-sync";
export const syncJobSchema = z
  .object({ seed: seedSchema, maximumRequests: z.number().int().min(1).max(5_000) })
  .strict();

export async function createJobQueue(databaseUrl: string) {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: "jobs", createSchema: false });
  // The emitter must have a listener; raw driver errors may contain connection configuration.
  boss.on("error", () => process.stderr.write("Background queue operation failed.\n"));
  await boss.start();
  await boss.createQueue(SYNC_QUEUE, {
    policy: "exclusive",
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 900,
  });
  return boss;
}

export async function startWorker(config: {
  databaseUrl: string;
  githubToken: string;
  seed: unknown;
  maximumRequests: number;
  schedule: boolean;
}) {
  const job = syncJobSchema.parse({ seed: config.seed, maximumRequests: config.maximumRequests });
  const database = createDatabase({ connectionString: config.databaseUrl, maximumConnections: 4 });
  const boss = await createJobQueue(config.databaseUrl);
  await boss.work<unknown, { status: string; requests: number }>(
    SYNC_QUEUE,
    { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 5 },
    async (jobs) => {
      for (const queued of jobs) {
        const input = syncJobSchema.parse(queued.data);
        const client = createGitHubClient({
          token: config.githubToken,
          maximumRequests: input.maximumRequests,
        });
        const result = await collectGitHub(database, client, input.seed);
        if (result.status === "budget_exhausted")
          throw new Error(
            "GitHub request budget exhausted; persisted source checkpoints will resume on retry",
          );
        return { status: result.status, requests: result.requests };
      }
      throw new Error("Queue delivered an empty batch");
    },
  );
  if (config.schedule)
    await boss.schedule(SYNC_QUEUE, "0 */6 * * *", job, { singletonKey: "seed" });
  await boss.send(SYNC_QUEUE, job, { singletonKey: "seed" });
  return {
    boss,
    async stop() {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await database.close();
    },
  };
}
