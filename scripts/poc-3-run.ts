import { config as loadDotenv } from "dotenv";
import fs from "fs/promises";
import path from "path";
import postgres from "postgres";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env", override: false });

const ASSERTION_COUNT = 6;
const WORKER_COUNT = 5;
const BATCH_SIZE = 10;
const SQL_FILES = {
  seed: "tests/poc/poc-3-seed.sql",
  cleanup: "tests/poc/poc-3-cleanup.sql",
} as const;

type SqlClient = ReturnType<typeof postgres>;

type OutboxRow = {
  id: string;
};

type WorkerResult = {
  workerId: number;
  claimed: number;
  sent: number;
  batches: number;
};

type AssertionCounts = {
  sent: number;
  pending: number;
  processing: number;
  attempts_gt_one: number;
  processing_started_null: number;
  duplicate_idempotency_keys: number;
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

async function claimBatch(sql: SqlClient) {
  return sql.begin(async (tx) => {
    const rows = await tx<OutboxRow[]>`
      SELECT *
      FROM pit_v24_poc.notification_outbox
      WHERE status = 'pending'
        AND next_attempt_at <= now()
        AND (scheduled_at IS NULL OR scheduled_at <= now())
      ORDER BY next_attempt_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;

    const pickedIds = rows.map((row) => row.id);
    if (pickedIds.length === 0) {
      return pickedIds;
    }

    await tx`
      UPDATE pit_v24_poc.notification_outbox
      SET status = 'processing',
          processing_started_at = now(),
          attempts = attempts + 1
      WHERE id = ANY(${tx.array(pickedIds)}::uuid[])
    `;

    return pickedIds;
  });
}

async function markSent(sql: SqlClient, pickedIds: string[]) {
  const rows = await sql<OutboxRow[]>`
    UPDATE pit_v24_poc.notification_outbox
    SET status = 'sent',
        sent_at = now()
    WHERE id = ANY(${sql.array(pickedIds)}::uuid[])
      AND status = 'processing'
    RETURNING id
  `;

  return rows.length;
}

async function runWorker(sql: SqlClient, workerId: number): Promise<WorkerResult> {
  const result: WorkerResult = {
    workerId,
    claimed: 0,
    sent: 0,
    batches: 0,
  };

  while (true) {
    const pickedIds = await claimBatch(sql);
    if (pickedIds.length === 0) {
      break;
    }

    result.claimed += pickedIds.length;
    result.batches += 1;
    result.sent += await markSent(sql, pickedIds);
  }

  return result;
}

async function queryAssertionCounts(sql: SqlClient): Promise<AssertionCounts> {
  const rows = await sql<AssertionCounts[]>`
    WITH scoped AS (
      SELECT *
      FROM pit_v24_poc.notification_outbox
      WHERE idempotency_key LIKE 'poc3-%'
    ),
    duplicate_keys AS (
      SELECT idempotency_key
      FROM scoped
      GROUP BY idempotency_key
      HAVING count(*) > 1
    )
    SELECT
      count(*) FILTER (WHERE status = 'sent')::int AS sent,
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'processing')::int AS processing,
      count(*) FILTER (WHERE attempts > 1)::int AS attempts_gt_one,
      count(*) FILTER (WHERE processing_started_at IS NULL)::int AS processing_started_null,
      (SELECT count(*)::int FROM duplicate_keys) AS duplicate_idempotency_keys
    FROM scoped
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("queryAssertionCounts: empty result");
  }

  return row;
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
    max: 5,
  });

  try {
    console.log("Applying poc-3-seed.sql");
    await runSqlFile(sql, SQL_FILES.seed);

    console.log(`Launching ${WORKER_COUNT} parallel workers`);
    const workerResults = await Promise.all(
      Array.from({ length: WORKER_COUNT }, (_, index) => runWorker(sql, index + 1)),
    );

    for (const result of workerResults) {
      console.log(
        `Worker ${result.workerId}: batches=${result.batches}, claimed=${result.claimed}, sent=${result.sent}`,
      );
    }

    const totalClaimed = workerResults.reduce((sum, result) => sum + result.claimed, 0);
    const totalSentByWorkers = workerResults.reduce((sum, result) => sum + result.sent, 0);
    console.log(`Worker totals: claimed=${totalClaimed}, sent=${totalSentByWorkers}`);

    const counts = await queryAssertionCounts(sql);
    console.log(
      `Final counts: sent=${counts.sent}, pending=${counts.pending}, processing=${counts.processing}, attempts_gt_one=${counts.attempts_gt_one}, processing_started_null=${counts.processing_started_null}, duplicate_idempotency_keys=${counts.duplicate_idempotency_keys}`,
    );

    assertEqual("sent rows", counts.sent, 100);
    passedAssertions += 1;
    assertEqual("pending rows", counts.pending, 0);
    passedAssertions += 1;
    assertEqual("processing rows", counts.processing, 0);
    passedAssertions += 1;
    assertEqual("attempts > 1 rows", counts.attempts_gt_one, 0);
    passedAssertions += 1;
    assertEqual("processing_started_at IS NULL rows", counts.processing_started_null, 0);
    passedAssertions += 1;
    assertEqual("duplicate idempotency_key groups", counts.duplicate_idempotency_keys, 0);
    passedAssertions += 1;
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: ${message}`);
  } finally {
    try {
      console.log("Applying poc-3-cleanup.sql");
      await runSqlFile(sql, SQL_FILES.cleanup);
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`CLEANUP ERROR: ${message}`);
    }

    await sql.end();
  }

  if (!failed && passedAssertions === ASSERTION_COUNT) {
    console.log("ALL ASSERTIONS PASSED");
    process.exit(0);
  }

  console.error(`FAILED: ${passedAssertions}/${ASSERTION_COUNT} assertions passed`);
  process.exit(1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Unhandled error: ${message}`);
  process.exit(1);
});
