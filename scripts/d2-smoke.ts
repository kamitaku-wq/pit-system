import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env', override: false });

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERROR: DIRECT_URL or DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false });
const action = process.argv[2] ?? 'insert';
const validActions = ['insert', 'status', 'force-stale', 'cleanup'] as const;

type SmokeRow = {
  id: string; status: string; attempts: number; sent_at: Date | null; last_error: string | null;
  next_attempt_at: Date; processing_started_at: Date | null; created_at: Date;
};

function fail(message: string): 1 {
  console.error(message);
  return 1;
}

async function insertSmoke(): Promise<0 | 1> {
  console.log('Fetching company for D2 smoke row...');
  const [company] = await sql<{ id: string }[]>`SELECT id FROM companies LIMIT 1`;
  if (!company) return fail('ERROR: No company found in companies table.');

  const payload = { channel: 'email', to: process.argv[3] ?? 'kamitaku@funct.jp', subject: 'D2 smoke test', html: '<p>D2 smoke test</p>' };
  console.log('Inserting D2 smoke outbox row...');
  const [row] = await sql<SmokeRow[]>`
    INSERT INTO notification_outbox (event_type, target_type, target_id, company_id, idempotency_key, payload)
    VALUES ('d2_smoke', 'store_user', gen_random_uuid(), ${company.id}::uuid, ${`d2-smoke-${crypto.randomUUID()}`}, ${sql.json(payload)})
    RETURNING id, status, attempts, sent_at, last_error, next_attempt_at, processing_started_at, created_at
  `;
  console.log(JSON.stringify(row, null, 2));
  return 0;
}

async function statusSmoke() {
  console.log('Fetching recent D2 smoke rows...');
  const rows = await sql<SmokeRow[]>`
    SELECT id, status, attempts, sent_at, last_error, next_attempt_at, processing_started_at, created_at
    FROM notification_outbox
    WHERE event_type = 'd2_smoke'
    ORDER BY created_at DESC
    LIMIT 10
  `;
  console.log(JSON.stringify(rows, null, 2));
}

async function forceStaleSmoke() {
  console.log('Forcing D2 smoke rows stale...');
  const result = await sql`
    UPDATE notification_outbox SET status = 'processing', processing_started_at = now() - interval '10 minutes'
    WHERE event_type = 'd2_smoke' AND status IN ('pending', 'sent')
  `;
  console.log(JSON.stringify({ updated: result.count }, null, 2));
}

async function cleanupSmoke() {
  console.log('Deleting D2 smoke rows...');
  const result = await sql`DELETE FROM notification_outbox WHERE event_type = 'd2_smoke'`;
  console.log(JSON.stringify({ deleted: result.count }, null, 2));
}

async function main() {
  let exitCode: 0 | 1 = 0;
  try {
    if (action === 'insert') exitCode = await insertSmoke();
    else if (action === 'status') await statusSmoke();
    else if (action === 'force-stale') await forceStaleSmoke();
    else if (action === 'cleanup') await cleanupSmoke();
    else exitCode = fail(`Unknown action "${action}". Valid actions: ${validActions.join(', ')}`);
  } finally {
    await sql.end();
  }
  if (exitCode !== 0) process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
