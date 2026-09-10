import "dotenv/config";
import { createDatabase } from "@gia-github/db";

const adminUrl = new URL(
  process.env.DATABASE_ADMIN_URL ??
    "postgresql://gia_github:local-development-only@127.0.0.1:55448/gia_github",
);
if (
  !["127.0.0.1", "localhost"].includes(adminUrl.hostname) ||
  adminUrl.pathname !== "/gia_github"
) {
  throw new Error("Local database preparation requires the dedicated local gia_github database.");
}
const admin = createDatabase({ connectionString: adminUrl.toString() });
try {
  for (const name of ["gia_github_test", "gia_github_runtime"]) {
    const existing = await admin.pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) await admin.pool.query(`CREATE DATABASE ${name}`);
  }
  for (const role of [
    { name: "gia_github_writer", password: "local-write-only" },
    { name: "gia_github_reader", password: "local-read-only" },
  ]) {
    const existing = await admin.pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [
      role.name,
    ]);
    if (existing.rowCount === 0) {
      const { rows } = await admin.pool.query<{ statement: string }>(
        "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', $1::text, $2::text) AS statement",
        [role.name, role.password],
      );
      const statement = rows[0]?.statement;
      if (!statement) throw new Error("Could not construct role provisioning statement.");
      await admin.pool.query(statement);
    }
  }
  for (const name of ["gia_github", "gia_github_test"]) {
    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${name}`;
    const database = createDatabase({ connectionString: databaseUrl.toString() });
    try {
      await database.pool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await database.pool.query("CREATE SCHEMA IF NOT EXISTS jobs AUTHORIZATION gia_github_writer");
      await database.pool.query(
        "ALTER ROLE gia_github_reader SET default_transaction_read_only = on",
      );
    } finally {
      await database.close();
    }
  }
  process.stdout.write(
    "Dedicated application, integration-test, and Gia registry databases are ready.\n",
  );
} finally {
  await admin.close();
}
