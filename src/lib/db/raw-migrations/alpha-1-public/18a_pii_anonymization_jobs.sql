-- Phase B-1b: pii_anonymization_jobs (spec §11.2b, lines 1259-1287)
-- 顧客削除リクエストから 30 日後に PII を匿名化する Inngest scheduled job のタスクキュー
-- state machine: pending -> verified -> scheduled -> processing -> (completed | failed | legal_hold)
-- v_accounting_audit_trail VIEW は service_tickets 完備依存のため α-2 送り (本ファイル除外)

CREATE TABLE pii_anonymization_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id               uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  anonymized_customer_key   uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_at              timestamptz NOT NULL,
  verified_at               timestamptz NULL,
  scheduled_for             timestamptz NOT NULL,
  processed_at              timestamptz NULL,
  status                    text NOT NULL CHECK (status IN (
                              'pending', 'verified', 'scheduled', 'processing',
                              'completed', 'failed', 'legal_hold'
                            )),
  failure_reason            text NULL,
  legal_hold_reason         text NULL,
  retry_count               int NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   int NOT NULL DEFAULT 1,
  CONSTRAINT pii_anonymization_jobs_unique_pending
    EXCLUDE USING btree (customer_id WITH =)
    WHERE (status IN ('pending', 'verified', 'scheduled', 'processing'))
);

CREATE INDEX idx_pii_anonymization_jobs_scheduled
  ON pii_anonymization_jobs (scheduled_for, status)
  WHERE status IN ('pending', 'verified', 'scheduled');

CREATE INDEX idx_pii_anonymization_jobs_anonymized_key
  ON pii_anonymization_jobs (anonymized_customer_key);
