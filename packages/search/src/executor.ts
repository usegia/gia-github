import type { PostgresExecutorPool } from "@gia/client";
import pg from "pg";

export function createExecutorPool(pool: pg.Pool, cancellationPool: pg.Pool): PostgresExecutorPool {
  return {
    async connect() {
      const client = await pool.connect();
      const backendPid: unknown = Reflect.get(client, "processID");
      if (typeof backendPid !== "number" || !Number.isSafeInteger(backendPid) || backendPid <= 0) {
        client.release(true);
        throw new Error("PostgreSQL connection has no valid process identity");
      }
      return {
        backendPid,
        async query(text, values) {
          const result = await client.query(text, values === undefined ? undefined : [...values]);
          return { rows: result.rows };
        },
        stream(query) {
          const nativeQuery = new pg.Query({ text: query.text, values: [...query.values] });
          nativeQuery.on("row", query.onRow);
          nativeQuery.once("error", query.onError);
          nativeQuery.once("end", query.onEnd);
          client.query(nativeQuery);
        },
        release(destroy) {
          client.release(destroy);
        },
      };
    },
    async cancelBackend(backendPid) {
      await cancellationPool.query("SELECT pg_cancel_backend($1)", [backendPid]);
    },
  };
}
