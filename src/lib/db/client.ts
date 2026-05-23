import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

// runtime クエリは Supabase pooler (transaction mode, port 6543) を使う。
// prepare: false は pgBouncer transaction mode で必須。
// migration / drizzle-kit / apply-raw-sql は DIRECT_URL (port 5432) を使う (drizzle.config.ts 参照)。
const queryClient = postgres(databaseUrl, { prepare: false });

export const db = drizzle(queryClient);
export type DB = typeof db;
