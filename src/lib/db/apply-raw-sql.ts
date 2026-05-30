import { config as loadDotenv } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env', override: false });

async function main() {
  const dir = process.argv[2] ?? './src/lib/db/raw-migrations';
  const resolvedDir = path.resolve(dir);

  // raw SQL は CREATE EXTENSION / CREATE TRIGGER / CREATE POLICY 等を含むため
  // session 接続 (DIRECT_URL, port 5432) を必須とする。pgBouncer transaction mode
  // (DATABASE_URL, port 6543) ではこれらの DDL が動かない。
  const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!migrationUrl) {
    console.error('ERROR: DIRECT_URL or DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const sql = postgres(migrationUrl, { prepare: false });

  try {
    // Ensure tracking table exists
    await sql`
      CREATE TABLE IF NOT EXISTS _raw_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // Read and sort SQL files
    let files: string[];
    try {
      const entries = await fs.readdir(resolvedDir);
      files = entries
        .filter((f) => f.endsWith('.sql'))
        .sort();
    } catch (err) {
      console.error(`ERROR: Cannot read directory ${resolvedDir}:`, err);
      await sql.end();
      process.exit(1);
    }

    if (files.length === 0) {
      console.log(`No .sql files found in ${resolvedDir}.`);
      await sql.end();
      return;
    }

    let applied = 0;
    let skipped = 0;

    for (const filename of files) {
      // Check if already applied
      const rows = await sql`
        SELECT 1 FROM _raw_migrations WHERE filename = ${filename}
      `;

      if (rows.length > 0) {
        console.log(`[SKIP] ${filename}`);
        skipped++;
        continue;
      }

      const filePath = path.join(resolvedDir, filename);
      console.log(`[APPLY] ${filename}...`);

      const sqlContent = await fs.readFile(filePath, 'utf8');

      await sql.unsafe(sqlContent);

      await sql`
        INSERT INTO _raw_migrations (filename) VALUES (${filename})
      `;

      console.log(`[DONE] ${filename}`);
      applied++;
    }

    console.log(`\nCompleted: ${applied} applied, ${skipped} skipped.`);
  } catch (err) {
    console.error('ERROR applying migration:', err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
