import { config as loadDotenv } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env', override: false });

type Step = {
  name: string;
  file: string;
};

type SqlClient = ReturnType<typeof postgres>;

const seedStep: Step = { name: 'seed', file: 'tests/poc/poc-14-seed.sql' };
const verifyStep: Step = { name: 'verify', file: 'tests/poc/poc-14-verify.sql' };
const cleanupStep: Step = { name: 'cleanup', file: 'tests/poc/poc-14-cleanup.sql' };

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DIRECT_URL or DATABASE_URL environment variable is not set.');
  }

  return databaseUrl;
}

async function runSqlFile(
  sql: SqlClient,
  step: Step,
): Promise<void> {
  const filePath = path.resolve(step.file);
  const sqlContent = await fs.readFile(filePath, 'utf8');

  console.log(`[RUN] ${step.name}: ${step.file}`);
  await sql.unsafe(sqlContent);
  console.log(`[OK] ${step.name}`);
}

async function main(): Promise<void> {
  const sql = postgres(getDatabaseUrl(), { prepare: false, max: 1 });
  let seedSucceeded = false;
  let hadFailure = false;

  try {
    try {
      await runSqlFile(sql, seedStep);
      seedSucceeded = true;
    } catch (error) {
      hadFailure = true;
      console.error(`[FAIL] ${seedStep.name}`);
      console.error(error);
    }

    if (seedSucceeded) {
      try {
        await runSqlFile(sql, verifyStep);
      } catch (error) {
        hadFailure = true;
        console.error(`[FAIL] ${verifyStep.name}`);
        console.error(error);
      }
    } else {
      hadFailure = true;
      console.error(`[SKIP] ${verifyStep.name}: seed failed`);
    }

    try {
      await runSqlFile(sql, cleanupStep);
    } catch (error) {
      hadFailure = true;
      console.error(`[FAIL] ${cleanupStep.name}`);
      console.error(error);
    }

    if (hadFailure) {
      process.exitCode = 1;
      return;
    }

    console.log('PoC #14 verification completed.');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('[FAIL] unhandled');
  console.error(error);
  process.exit(1);
});
