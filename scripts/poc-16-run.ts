import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";
import postgres from "postgres";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env", override: false });

const VERIFY_SQL = "tests/poc/poc-16-verify.sql";
const PASS_NOTICE = "PoC #16";

function readVerifySql() {
  return fs.readFileSync(path.resolve(VERIFY_SQL), "utf8");
}

function fail(message: string) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) {
    fail("PoC #16 FAILED: DATABASE_URL or DIRECT_URL environment variable is not set.");
    return;
  }

  let noticeSeen = false;
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    onnotice: (notice) => {
      if (notice.message?.startsWith(PASS_NOTICE)) {
        noticeSeen = true;
      }
    },
  });

  try {
    const verifySql = readVerifySql();
    await sql.unsafe(verifySql);

    if (noticeSeen) {
      console.log("PoC #16 PASSED");
      process.exit(0);
    }

    fail("PoC #16 FAILED: NOTICE not received");
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
