import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "@gia-github/db";
import { migrateDatabase } from "@gia-github/db/migrate";
import { grantApplicationRoles } from "@gia-github/db/roles";
import { importCaptureDirectory } from "../../apps/worker/src/importer.ts";

export const captureDirectory = fileURLToPath(new URL("../../fixtures/github", import.meta.url));

/** Every test file owns a fresh real database. Vitest serializes files sharing it. */
export async function setupIntegrationDatabase(): Promise<Database> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required. Run pnpm db:setup first.");
  const url = new URL(connectionString);
  if (url.pathname !== "/gia_github_test") {
    throw new Error("Refusing to reset any database except gia_github_test.");
  }
  const database = createDatabase({ connectionString });
  try {
    await database.pool.query(
      "DROP SCHEMA IF EXISTS github, ingest, operations, drizzle, jobs CASCADE",
    );
    await database.pool.query("CREATE SCHEMA jobs AUTHORIZATION gia_github_writer");
    await migrateDatabase(database);
    await grantApplicationRoles(database);
    await importCaptureDirectory(database, captureDirectory);
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}
