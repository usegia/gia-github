import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";

export type AdmissionLimits = {
  maximumConcurrentSearches: number;
  maximumDailySearches: number;
  maximumSearchesPerMinute: number;
  timeoutMs: number;
};
export type Admission =
  | { kind: "accepted" }
  | { kind: "rejected"; code: "SEARCH_BUSY" | "RATE_LIMITED" | "DAILY_LIMIT_REACHED" };
const countsSchema = z.object({
  concurrent: z.number().int(),
  daily: z.number().int(),
  recent: z.number().int(),
});

export async function admitSearch(
  pool: pg.Pool,
  input: AdmissionLimits & { id: string; clientKey: string; evaluationTime?: Date },
): Promise<Admission> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='3000ms'");
    await client.query("SELECT pg_advisory_xact_lock(709864231)");
    const clientHash = createHash("sha256").update(input.clientKey).digest("hex");
    const result = await client.query(
      `SELECT
      count(*) FILTER (WHERE finished_at IS NULL AND created_at > COALESCE($3::timestamptz,statement_timestamp()) - $2::integer * interval '1 millisecond')::integer AS concurrent,
      count(*) FILTER (WHERE created_at >= date_trunc('day', COALESCE($3::timestamptz,statement_timestamp()) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
      count(*) FILTER (WHERE client_hash=$1 AND created_at > COALESCE($3::timestamptz,statement_timestamp())-interval '1 minute')::integer AS recent
      FROM operations.search_requests
      WHERE created_at <= COALESCE($3::timestamptz,statement_timestamp()) AND created_at >= LEAST(date_trunc('day', COALESCE($3::timestamptz,statement_timestamp()) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', COALESCE($3::timestamptz,statement_timestamp())-interval '1 minute', COALESCE($3::timestamptz,statement_timestamp())-$2::integer*interval '1 millisecond')`,
      [clientHash, input.timeoutMs + 30_000, input.evaluationTime ?? null],
    );
    const counts = countsSchema.parse(result.rows[0]);
    const code =
      counts.daily >= input.maximumDailySearches
        ? "DAILY_LIMIT_REACHED"
        : counts.recent >= input.maximumSearchesPerMinute
          ? "RATE_LIMITED"
          : counts.concurrent >= input.maximumConcurrentSearches
            ? "SEARCH_BUSY"
            : null;
    if (code !== null) {
      await client.query("ROLLBACK");
      return { kind: "rejected", code };
    }
    await client.query(
      "INSERT INTO operations.search_requests (id, client_hash, created_at) VALUES ($1,$2,COALESCE($3::timestamptz,statement_timestamp()))",
      [input.id, clientHash, input.evaluationTime ?? null],
    );
    await client.query("COMMIT");
    return { kind: "accepted" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function finishSearch(
  pool: pg.Pool,
  input: { id: string; outcome: string; runtimeRequestId: string | null; durationMs: number },
): Promise<void> {
  await pool.query(
    "UPDATE operations.search_requests SET finished_at=now(),outcome=$2,runtime_request_id=$3,duration_ms=$4 WHERE id=$1",
    [input.id, input.outcome, input.runtimeRequestId, Math.round(input.durationMs)],
  );
}
