import "dotenv/config";
import { createDatabase } from "@gia-github/db";
import { grantApplicationRoles } from "@gia-github/db/roles";

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required to grant database roles.");
const database = createDatabase({ connectionString });
try {
  await grantApplicationRoles(database);
  process.stdout.write("Application writer and Gia reader permissions applied.\n");
} finally {
  await database.close();
}
