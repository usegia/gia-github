import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schema } from "./schema.ts";

export function createDatabase(input: { connectionString: string; maximumConnections?: number }) {
  const pool = new pg.Pool({
    connectionString: input.connectionString,
    max: input.maximumConnections ?? 8,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: "gia-github",
  });
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}

export type Database = ReturnType<typeof createDatabase>;
export type DatabaseTransaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
