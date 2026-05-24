import postgres from 'postgres';
import { inngest } from '@/lib/inngest/instance';

const BATCH_SIZE = 50;

type SqlClient = ReturnType<typeof postgres>;

type InboxCandidateRow = {
  id: string;
  companyId: string;
  targetId: string;
  payload: Record<string, unknown>;
  transportOrderId: string | null;
  transportOrderInvitationId: string | null;
};

const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL or DIRECT_URL environment variable is required for inbox-worker');
}

async function selectPendingInbox(sql: SqlClient) {
  return sql<InboxCandidateRow[]>`
    SELECT
      outbox.id,
      outbox.company_id AS "companyId",
      outbox.target_id AS "targetId",
      outbox.payload,
      outbox.transport_order_id AS "transportOrderId",
      outbox.transport_order_invitation_id AS "transportOrderInvitationId"
    FROM notification_outbox AS outbox
    WHERE outbox.status = 'sent'
      AND outbox.target_type = 'vendor'
      AND NOT EXISTS (
        SELECT 1 FROM vendor_portal_inbox WHERE outbox_id = outbox.id
      )
    ORDER BY outbox.sent_at
    LIMIT ${BATCH_SIZE}
  `;
}

async function reflectiveInsert(sql: SqlClient, rows: InboxCandidateRow[]) {
  if (rows.length === 0) {
    return 0;
  }

  const insertedRows = await sql<{ id: string }[]>`
    WITH picked AS (
      SELECT outbox.id, outbox.company_id, outbox.target_id, outbox.payload,
             outbox.transport_order_id, outbox.transport_order_invitation_id
      FROM notification_outbox AS outbox
      WHERE outbox.status = 'sent'
        AND outbox.target_type = 'vendor'
        AND NOT EXISTS (
          SELECT 1 FROM vendor_portal_inbox WHERE outbox_id = outbox.id
        )
      ORDER BY outbox.sent_at
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    )
    INSERT INTO vendor_portal_inbox (
      company_id, vendor_id, recipient_vendor_user_id, outbox_id,
      transport_order_id, transport_order_invitation_id,
      title, body, severity
    )
    SELECT
      picked.company_id, picked.target_id, NULL, picked.id,
      picked.transport_order_id, picked.transport_order_invitation_id,
      coalesce(picked.payload ->> 'subject', 'お知らせ'),
      coalesce(picked.payload ->> 'html', picked.payload ->> 'body', ''),
      'info'
    FROM picked
    RETURNING id
  `;

  return insertedRows.length;
}

export const inboxWorker = inngest.createFunction(
  {
    id: 'inbox-worker',
    name: 'Inbox Worker',
    concurrency: 1,
  },
  { cron: '*/1 * * * *' },
  async ({ step, logger }) => {
    const sql = postgres(databaseUrl, { prepare: false, max: 5 });

    try {
      const rows = await step.run('select-pending-inbox', () => selectPendingInbox(sql));
      logger.info('inbox-worker select completed', { pending: rows.length });

      const inserted = await step.run('reflective-insert', () => reflectiveInsert(sql, rows));
      logger.info('inbox-worker insert completed', { inserted });

      return {
        pending: rows.length,
        inserted,
      };
    } finally {
      await sql.end();
    }
  },
);
