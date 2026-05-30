import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env", override: false });

// drizzle-kit migrate / generate / push は session 接続 (port 5432) が必須。
// pgBouncer transaction mode (port 6543) では prepared statement / advisory lock が
// 動かないため、DIRECT_URL を優先。runtime クエリ (src/lib/db/client.ts) は
// pooler (DATABASE_URL) を使う。
const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!migrationUrl) {
  console.warn("[drizzle.config] DIRECT_URL / DATABASE_URL not set");
}

export default defineConfig({
  schema: "./src/lib/db/schema/*",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: migrationUrl ?? "postgres://placeholder" },
  strict: true,
  verbose: true,
  schemaFilter: ["public"],
});
