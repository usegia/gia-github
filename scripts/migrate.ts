import "dotenv/config";
import { createDatabase } from "@gia-github/db";
import { migrateDatabase } from "@gia-github/db/migrate";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for migrations");
const database = createDatabase({ connectionString });
try {
  await migrateDatabase(database);
  console.log("Database migrations applied.");
} finally {
  await database.close();
}
