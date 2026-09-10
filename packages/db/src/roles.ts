import type { Database } from "./client.ts";

/** Run as the migration owner after schema changes. The reader cannot access ingestion or operations. */
export async function grantApplicationRoles(database: Database): Promise<void> {
  await database.pool.query(`
    GRANT USAGE ON SCHEMA github, ingest, operations TO gia_github_writer;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA github, ingest, operations TO gia_github_writer;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA github, ingest, operations TO gia_github_writer;
    GRANT USAGE ON SCHEMA github TO gia_github_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA github TO gia_github_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA github, ingest, operations
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gia_github_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA github, ingest, operations
      GRANT USAGE, SELECT ON SEQUENCES TO gia_github_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA github GRANT SELECT ON TABLES TO gia_github_reader;
  `);
}
