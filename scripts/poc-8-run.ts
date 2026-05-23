import { config as loadDotenv } from "dotenv";
import fs from "fs/promises";
import path from "path";
import postgres from "postgres";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env", override: false });

const ASSERTION_COUNT = 5;
const COMPANY_ID = "00000008-0000-4000-8000-000000000001";
const VENDOR_ID = "00000008-0000-4000-8000-000000000101";
const VENDOR_USER_ID = "00000008-0000-4000-8000-000000000201";
const SQL_FILES = {
  seed: "tests/poc/poc-8-seed.sql",
  cleanup: "tests/poc/poc-8-cleanup.sql",
} as const;

type SqlClient = ReturnType<typeof postgres>;

type CountRow = {
  count: number;
};

type InboxRow = {
  id: string;
};

async function readSqlFile(relativePath: string) {
  return fs.readFile(path.resolve(relativePath), "utf8");
}

async function runSqlFile(sql: SqlClient, relativePath: string) {
  const sqlContent = await readSqlFile(relativePath);
  await sql.unsafe(sqlContent);
}

function assertEqual(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }

  console.log(`OK: ${label} = ${expected}`);
}

async function queryCount(sql: SqlClient, label: string, query: Promise<CountRow[]>) {
  const rows = await query;
  const row = rows[0];
  if (!row) {
    throw new Error(`${label}: empty result`);
  }

  return row.count;
}

async function createInboxRows(sql: SqlClient) {
  const rows = await sql<InboxRow[]>`
    INSERT INTO pit_v24_poc.vendor_portal_inbox (
      notification_outbox_id,
      vendor_id,
      vendor_user_id,
      company_id,
      subject,
      body
    )
    SELECT
      notification_outbox.id,
      notification_outbox.target_id,
      ${VENDOR_USER_ID}::uuid,
      notification_outbox.company_id,
      coalesce(notification_outbox.payload ->> 'subject', 'PoC 8 notification'),
      coalesce(notification_outbox.payload ->> 'body', 'PoC 8 inbox body')
    FROM pit_v24_poc.notification_outbox
    WHERE notification_outbox.idempotency_key LIKE 'poc8-%'
      AND notification_outbox.company_id = ${COMPANY_ID}::uuid
      AND notification_outbox.target_type = 'vendor'
      AND notification_outbox.target_id = ${VENDOR_ID}::uuid
      AND NOT EXISTS (
        SELECT 1
        FROM pit_v24_poc.vendor_portal_inbox
        WHERE vendor_portal_inbox.notification_outbox_id = notification_outbox.id
      )
    ORDER BY notification_outbox.idempotency_key
    RETURNING id
  `;

  return rows.length;
}

async function queryInboxCount(sql: SqlClient) {
  return queryCount(
    sql,
    "inbox rows",
    sql<CountRow[]>`
      SELECT count(*)::int AS count
      FROM pit_v24_poc.vendor_portal_inbox
      JOIN pit_v24_poc.notification_outbox
        ON notification_outbox.id = vendor_portal_inbox.notification_outbox_id
      WHERE notification_outbox.idempotency_key LIKE 'poc8-%'
    `,
  );
}

async function queryInvalidOutboxReferenceCount(sql: SqlClient) {
  return queryCount(
    sql,
    "invalid outbox references",
    sql<CountRow[]>`
      SELECT count(*)::int AS count
      FROM pit_v24_poc.vendor_portal_inbox
      LEFT JOIN pit_v24_poc.notification_outbox
        ON notification_outbox.id = vendor_portal_inbox.notification_outbox_id
      WHERE vendor_portal_inbox.company_id = ${COMPANY_ID}::uuid
        AND vendor_portal_inbox.vendor_id = ${VENDOR_ID}::uuid
        AND vendor_portal_inbox.vendor_user_id = ${VENDOR_USER_ID}::uuid
        AND notification_outbox.id IS NULL
    `,
  );
}

async function queryVendorUserInboxCount(sql: SqlClient) {
  return queryCount(
    sql,
    "vendor_user inbox rows",
    sql<CountRow[]>`
      SELECT count(*)::int AS count
      FROM pit_v24_poc.vendor_portal_inbox
      WHERE vendor_user_id = ${VENDOR_USER_ID}::uuid
    `,
  );
}

async function queryUnreadCount(sql: SqlClient) {
  return queryCount(
    sql,
    "unread inbox rows",
    sql<CountRow[]>`
      SELECT count(*)::int AS count
      FROM pit_v24_poc.vendor_portal_inbox
      WHERE company_id = ${COMPANY_ID}::uuid
        AND vendor_id = ${VENDOR_ID}::uuid
        AND vendor_user_id = ${VENDOR_USER_ID}::uuid
        AND is_read = false
    `,
  );
}

async function markOneInboxRowRead(sql: SqlClient) {
  const rows = await sql<InboxRow[]>`
    WITH picked AS (
      SELECT id
      FROM pit_v24_poc.vendor_portal_inbox
      WHERE company_id = ${COMPANY_ID}::uuid
        AND vendor_id = ${VENDOR_ID}::uuid
        AND vendor_user_id = ${VENDOR_USER_ID}::uuid
        AND is_read = false
      ORDER BY created_at, id
      LIMIT 1
    )
    UPDATE pit_v24_poc.vendor_portal_inbox
    SET is_read = true,
        read_at = now()
    FROM picked
    WHERE vendor_portal_inbox.id = picked.id
    RETURNING vendor_portal_inbox.id
  `;

  return rows.length;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL or DIRECT_URL environment variable is not set.");
    process.exit(1);
  }

  let failed = false;
  let passedAssertions = 0;
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 2,
  });

  try {
    console.log("Applying poc-8-seed.sql");
    await runSqlFile(sql, SQL_FILES.seed);

    console.log("Creating vendor_portal_inbox rows from notification_outbox");
    const insertedInboxRows = await createInboxRows(sql);
    console.log(`Inbox rows inserted: ${insertedInboxRows}`);

    assertEqual("inbox rows", await queryInboxCount(sql), 5);
    passedAssertions += 1;
    assertEqual("invalid outbox references", await queryInvalidOutboxReferenceCount(sql), 0);
    passedAssertions += 1;
    assertEqual("vendor_user inbox rows", await queryVendorUserInboxCount(sql), 5);
    passedAssertions += 1;
    assertEqual("unread inbox rows before read", await queryUnreadCount(sql), 5);
    passedAssertions += 1;

    const updatedRows = await markOneInboxRowRead(sql);
    if (updatedRows !== 1) {
      throw new Error(`mark read rows: expected 1, got ${updatedRows}`);
    }
    console.log("OK: mark read rows = 1");

    assertEqual("unread inbox rows after read", await queryUnreadCount(sql), 4);
    passedAssertions += 1;
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: ${message}`);
  } finally {
    try {
      console.log("Applying poc-8-cleanup.sql");
      await runSqlFile(sql, SQL_FILES.cleanup);
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`CLEANUP ERROR: ${message}`);
    }

    await sql.end();
  }

  if (!failed && passedAssertions === ASSERTION_COUNT) {
    console.log(`SUMMARY: ${passedAssertions}/${ASSERTION_COUNT} assertions passed`);
    console.log("ALL ASSERTIONS PASSED");
    process.exit(0);
  }

  console.error(`SUMMARY: ${passedAssertions}/${ASSERTION_COUNT} assertions passed`);
  console.error(`FAILED: ${passedAssertions}/${ASSERTION_COUNT} assertions passed`);
  process.exit(1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Unhandled error: ${message}`);
  process.exit(1);
});
