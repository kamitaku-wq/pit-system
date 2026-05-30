import postgres from "postgres";
import { Resend } from "resend";
import { inngest } from "@/lib/inngest/instance";

const BATCH_SIZE = 10;
const STALE_AFTER_MIN = 5;
const INITIAL_BACKOFF_SEC = 30;
const MAX_BACKOFF_SEC = 3600;

const RESEND_STATUS_BY_ERROR_NAME: Record<string, number> = {
  missing_required_field: 422,
  invalid_idempotency_key: 400,
  invalid_idempotent_request: 409,
  concurrent_idempotent_requests: 409,
  invalid_access: 422,
  invalid_parameter: 422,
  invalid_region: 422,
  rate_limit_exceeded: 429,
  missing_api_key: 401,
  invalid_api_Key: 403,
  invalid_from_address: 403,
  validation_error: 403,
  not_found: 404,
  method_not_allowed: 405,
  application_error: 500,
  internal_server_error: 500,
};

type SqlClient = ReturnType<typeof postgres>;

type OutboxRow = {
  id: string;
  idempotencyKey: string;
  targetType: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

type DispatchResult = {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
};

type SendOutcome = "sent" | "failed" | "retried";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required for outbox-dispatcher`);
  }

  return value;
}

const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL or DIRECT_URL environment variable is required for outbox-dispatcher");
}

const resendApiKey = requireEnv("RESEND_API_KEY");
const resendFromEmail = requireEnv("RESEND_FROM_EMAIL");
const resend = new Resend(resendApiKey);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorStatusCode(error: unknown) {
  if (!isRecord(error)) {
    return undefined;
  }

  const statusCode = error.statusCode;
  if (typeof statusCode === "number") {
    return statusCode;
  }

  const name = error.name;
  if (typeof name === "string") {
    return RESEND_STATUS_BY_ERROR_NAME[name];
  }

  return undefined;
}

function isPermanentResendError(error: unknown) {
  const statusCode = getErrorStatusCode(error);
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function backoffSeconds(attempts: number) {
  return Math.min(INITIAL_BACKOFF_SEC * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_SEC);
}

async function recoverStaleRows(sql: SqlClient) {
  const rows = await sql<{ id: string }[]>`
    UPDATE notification_outbox
    SET status = 'pending',
        processing_started_at = NULL
    WHERE status = 'processing'
      AND processing_started_at < now() - (${STALE_AFTER_MIN} * interval '1 minute')
    RETURNING id
  `;

  return rows.length;
}

async function claimBatch(sql: SqlClient) {
  return sql.begin(async (tx) => {
    const rows = await tx<OutboxRow[]>`
      WITH picked AS (
        SELECT id
        FROM notification_outbox
        WHERE status = 'pending'
          AND next_attempt_at <= now()
          AND (scheduled_at IS NULL OR scheduled_at <= now())
        ORDER BY next_attempt_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE notification_outbox AS outbox
      SET status = 'processing',
          processing_started_at = now(),
          attempts = outbox.attempts + 1
      FROM picked
      WHERE outbox.id = picked.id
      RETURNING
        outbox.id,
        outbox.idempotency_key AS "idempotencyKey",
        outbox.target_type AS "targetType",
        outbox.payload,
        outbox.attempts,
        outbox.max_attempts AS "maxAttempts"
    `;

    return rows.map((row) => ({
      ...row,
      payload: isRecord(row.payload) ? row.payload : {},
    }));
  });
}

async function markSent(sql: SqlClient, id: string) {
  await sql`
    UPDATE notification_outbox
    SET status = 'sent',
        sent_at = now()
    WHERE id = ${id}::uuid
      AND status = 'processing'
  `;
}

async function markFailed(sql: SqlClient, id: string, message: string) {
  await sql`
    UPDATE notification_outbox
    SET status = 'failed',
        processing_started_at = NULL,
        last_error = ${message}
    WHERE id = ${id}::uuid
      AND status = 'processing'
  `;
}

async function markRetry(sql: SqlClient, row: OutboxRow, message: string) {
  const delaySeconds = backoffSeconds(row.attempts);
  await sql`
    UPDATE notification_outbox
    SET status = 'pending',
        processing_started_at = NULL,
        next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
        last_error = ${message}
    WHERE id = ${row.id}::uuid
      AND status = 'processing'
  `;
}

async function sendRow(sql: SqlClient, row: OutboxRow): Promise<SendOutcome> {
  const channel = typeof row.payload.channel === "string" ? row.payload.channel : "email";
  if (channel !== "email") {
    await markFailed(sql, row.id, `unsupported channel: ${channel}`);
    return "failed";
  }

  try {
    const to = String(row.payload.to ?? "");
    const subject = String(row.payload.subject ?? "");
    const html = String(row.payload.html ?? "");
    const text = row.payload.text === undefined ? undefined : String(row.payload.text);

    // payload 欠損ガード (Phase 69 S1 / phase-68 監査 #15): to/subject/html が空のまま Resend に
    // 渡すと中身のない (または送信不能な) メールになる。空メール送信ではなく permanent failed として
    // 失敗一覧 (運用画面) に可視化する。retry しても自己修復しないため markFailed (markRetry でない)。
    const missingFields = [
      to.trim() === "" ? "to" : null,
      subject.trim() === "" ? "subject" : null,
      html.trim() === "" ? "html" : null,
    ].filter((field): field is string => field !== null);
    if (missingFields.length > 0) {
      await markFailed(sql, row.id, `missing email payload field(s): ${missingFields.join(", ")}`);
      return "failed";
    }
    const emailPayload = {
      from: resendFromEmail,
      to,
      subject,
      html,
      headers: {
        "Idempotency-Key": row.idempotencyKey,
      },
      ...(text === undefined ? {} : { text }),
    };

    const response = await resend.emails.send(
      emailPayload,
      {
        idempotencyKey: row.idempotencyKey,
      },
    );

    if (response.error) {
      const message = errorMessage(response.error);
      if (isPermanentResendError(response.error) || row.attempts >= row.maxAttempts) {
        await markFailed(sql, row.id, message);
        return "failed";
      }

      await markRetry(sql, row, message);
      return "retried";
    }

    await markSent(sql, row.id);
    return "sent";
  } catch (error) {
    const message = errorMessage(error);
    if (row.attempts >= row.maxAttempts) {
      await markFailed(sql, row.id, message);
      return "failed";
    }

    await markRetry(sql, row, message);
    return "retried";
  }
}

export const outboxDispatcher = inngest.createFunction(
  {
    id: "outbox-dispatcher",
    name: "Outbox Dispatcher",
    concurrency: 1,
  },
  { cron: "*/1 * * * *" },
  async ({ step, logger }) => {
    const sql = postgres(databaseUrl, {
      prepare: false,
      max: 5,
    });

    try {
      const recovered = await step.run("stale-recovery", () => recoverStaleRows(sql));
      logger.info("outbox-dispatcher stale recovery completed", { recovered });

      const claimedRows = await step.run("claim", () => claimBatch(sql));
      logger.info("outbox-dispatcher claim completed", { claimed: claimedRows.length });

      const result = await step.run("send-each", async (): Promise<DispatchResult> => {
        const summary: DispatchResult = {
          claimed: claimedRows.length,
          sent: 0,
          failed: 0,
          retried: 0,
        };

        for (const row of claimedRows) {
          const outcome = await sendRow(sql, row);
          summary[outcome] += 1;
        }

        return summary;
      });

      logger.info("outbox-dispatcher send completed", result);
      return result;
    } catch (error) {
      logger.error("outbox-dispatcher failed", { error: errorMessage(error) });
      throw error;
    } finally {
      await sql.end();
    }
  },
);
