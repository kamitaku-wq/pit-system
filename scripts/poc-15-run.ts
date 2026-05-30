import { config as loadDotenv } from "dotenv";
import fs from "fs/promises";
import path from "path";
import postgres from "postgres";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env", override: false });

const ASSERTION_COUNT = 6;
const ADMIN_USER_ID = "00000015-0000-4000-8000-000000000101";
const TRANSPORT_ORDER_ID = "00000015-0000-4000-8000-000000000201";
const SQL_FILES = {
  seed: "tests/poc/poc-15-seed.sql",
  cleanup: "tests/poc/poc-15-cleanup.sql",
} as const;

type SqlClient = ReturnType<typeof postgres>;
type SettledCall = PromiseSettledResult<postgres.RowList<postgres.Row[]>>;

type ResultCounts = {
  successes: number;
  uniqueViolations: number;
  deadlocks: number;
  otherErrors: number;
};

type FinalState = {
  winning: number;
  accepted: number;
  revoked: number;
  pending: number;
};

function invitationId(index: number) {
  return `00000015-0000-4000-8000-00000002${index.toString().padStart(4, "0")}`;
}

function pgErrorCode(reason: unknown) {
  if (reason && typeof reason === "object" && "code" in reason) {
    return String((reason as { code?: unknown }).code ?? "");
  }

  return "";
}

function assertEqual(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }

  console.log(`OK: ${label} = ${expected}`);
}

async function readSqlFile(relativePath: string) {
  return fs.readFile(path.resolve(relativePath), "utf8");
}

async function runSqlFile(sql: SqlClient, relativePath: string) {
  const sqlContent = await readSqlFile(relativePath);
  await sql.unsafe(sqlContent);
}

function collectResults(results: SettledCall[]): ResultCounts {
  return results.reduce<ResultCounts>(
    (counts, result) => {
      if (result.status === "fulfilled") {
        counts.successes += 1;
        return counts;
      }

      const code = pgErrorCode(result.reason);
      if (code === "23505") {
        counts.uniqueViolations += 1;
        return counts;
      }
      if (code === "40P01") {
        counts.deadlocks += 1;
        return counts;
      }

      counts.otherErrors += 1;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`OTHER ERROR: ${code || "unknown"} ${message}`);
      return counts;
    },
    { successes: 0, uniqueViolations: 0, deadlocks: 0, otherErrors: 0 },
  );
}

async function warmPool(sql: SqlClient) {
  await Promise.all(
    Array.from({ length: 50 }, (_, index) => sql`
      SELECT ${index}::int AS worker_index, pg_sleep(0.1)
    `),
  );
}

async function acceptInvitation(sql: SqlClient, id: string) {
  return sql`
    WITH start_barrier AS (
      SELECT pg_sleep(1.0)
    )
    SELECT pit_v24_poc.accept_invitation_and_revoke_others(
      ${id}::uuid,
      ${ADMIN_USER_ID}::uuid
    ) AS accepted_invitation_id
    FROM start_barrier
  `;
}

async function runConcurrentAccepts(sql: SqlClient) {
  const calls = Array.from(
    { length: 50 },
    (_, index) => acceptInvitation(sql, invitationId(index + 1)),
  );

  return Promise.allSettled(calls);
}

async function queryFinalState(sql: SqlClient): Promise<FinalState> {
  const rows = await sql<FinalState[]>`
    SELECT
      count(*) FILTER (WHERE is_winning_bid = true)::int AS winning,
      count(*) FILTER (WHERE response = 'accepted')::int AS accepted,
      count(*) FILTER (WHERE response = 'revoked')::int AS revoked,
      count(*) FILTER (WHERE response = 'pending')::int AS pending
    FROM pit_v24_poc.transport_order_invitations
    WHERE transport_order_id = ${TRANSPORT_ORDER_ID}::uuid
      AND deleted_at IS NULL
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("queryFinalState: empty result");
  }
  return row;
}

async function main() {
  const migrationUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!migrationUrl) {
    console.error("ERROR: DATABASE_URL or DIRECT_URL environment variable is not set.");
    process.exit(1);
  }

  let failed = false;
  let passedAssertions = 0;
  const sql = postgres(migrationUrl, {
    prepare: false,
    max: 50,
  });

  try {
    console.log("Applying seed.sql");
    await runSqlFile(sql, SQL_FILES.seed);

    console.log("Warming postgres-js pool");
    await warmPool(sql);

    console.log("Launching 50 concurrent accepts");
    const results = await runConcurrentAccepts(sql);
    const counts = collectResults(results);
    console.log(
      `Concurrent results: successes=${counts.successes}, unique_23505=${counts.uniqueViolations}, deadlock_40P01=${counts.deadlocks}, other_errors=${counts.otherErrors}`,
    );

    assertEqual("exactly 1 success", counts.successes, 1);
    passedAssertions += 1;
    // PoC scope: 23505 (partial unique violation) と 40P01 (deadlock) は合算で serialize failure とみなす。
    // 関数本体 (spec §7.10.2) は α-1 で advisory lock 化 or ON CONFLICT 化して deadlock-free にする。
    assertEqual("49 serialize failures (23505 + 40P01)", counts.uniqueViolations + counts.deadlocks, 49);
    passedAssertions += 1;
    assertEqual("0 other errors", counts.otherErrors, 0);
    passedAssertions += 1;

    const state = await queryFinalState(sql);
    console.log(
      `Final state: winning=${state.winning}, accepted=${state.accepted}, revoked=${state.revoked}, pending=${state.pending}`,
    );

    assertEqual("1 winning invitation", state.winning, 1);
    passedAssertions += 1;
    assertEqual("49 revoked invitations", state.revoked, 49);
    passedAssertions += 1;
    assertEqual("0 pending invitations", state.pending, 0);
    passedAssertions += 1;
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: ${message}`);
  } finally {
    try {
      console.log("Applying cleanup.sql");
      await runSqlFile(sql, SQL_FILES.cleanup);
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`CLEANUP ERROR: ${message}`);
    }

    await sql.end();
  }

  if (!failed && passedAssertions === ASSERTION_COUNT) {
    console.log(`All ${ASSERTION_COUNT} assertions passed`);
    return;
  }

  console.log(`FAILED: ${passedAssertions}/${ASSERTION_COUNT} assertions passed`);
  process.exit(1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Unhandled error: ${message}`);
  process.exit(1);
});
