import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      "postgresql://gia_github:local-development-only@127.0.0.1:55448/gia_github",
  },
});
