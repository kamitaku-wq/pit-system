import { config as loadDotenv } from "dotenv";
import fs from "fs/promises";
import path from "path";
import postgres from "postgres";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env", override: false });

const ASSERTION_COUNT = 5;
const SQL_FILES = {
  seed: "tests/poc/poc-06-seed.sql",
  verify: "tests/poc/poc-06-verify.sql",
  cleanup: "tests/poc/poc-06-cleanup.sql",
} as const;

type SqlClient = ReturnType<typeof postgres>;

async function readSqlFile(relativePath: string) {
  return fs.readFile(path.resolve(relativePath), "utf8");
}

async function runSqlFile(sql: SqlClient, relativePath: string) {
  const sqlContent = await readSqlFile(relativePath);
  await sql.unsafe(sqlContent);
}

async function main() {
  const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!migrationUrl) {
    console.error("ERROR: DIRECT_URL or DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  let passedAssertions = 0;
  let verifyFailed = false;
  let cleanupFailed = false;

  const sql = postgres(migrationUrl, {
    prepare: false,
    max: 1,
    onnotice: (notice) => {
      if (notice.message?.startsWith("OK:")) {
        passedAssertions += 1;
        console.log(notice.message);
      }
    },
  });

  try {
    await runSqlFile(sql, SQL_FILES.seed);

    try {
      await runSqlFile(sql, SQL_FILES.verify);
    } catch (err) {
      verifyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`VERIFY ERROR: ${message}`);
    }
  } catch (err) {
    verifyFailed = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`SETUP ERROR: ${message}`);
  } finally {
    try {
      await runSqlFile(sql, SQL_FILES.cleanup);
    } catch (err) {
      cleanupFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`CLEANUP ERROR: ${message}`);
    }

    await sql.end();
  }

  const failedAssertions = ASSERTION_COUNT - passedAssertions;
  if (!verifyFailed && !cleanupFailed && passedAssertions === ASSERTION_COUNT) {
    console.log("All 5 assertions passed");
    return;
  }

  console.log(`FAILED ${failedAssertions} assertions failed`);
  process.exit(1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Unhandled error: ${message}`);
  process.exit(1);
});
