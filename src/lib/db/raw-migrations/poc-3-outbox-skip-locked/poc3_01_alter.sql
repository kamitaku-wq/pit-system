-- PoC #3 outbox retry: notification_outbox に spec §8.1 確定列を追加
-- 骨格 DDL (poc12_13) は id/company_id/transport_order_id/reservation_id/invitation_id/timestamps のみ
-- 本 PoC で必要な処理状態カラムを ALTER で追加 (α-1 で本実装、PoC スコープ最小)

ALTER TABLE pit_v24_poc.notification_outbox
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS target_id uuid,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

ALTER TABLE pit_v24_poc.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_status_check,
  DROP CONSTRAINT IF EXISTS notification_outbox_target_type_check,
  DROP CONSTRAINT IF EXISTS notification_outbox_idempotency_key_key;

ALTER TABLE pit_v24_poc.notification_outbox
  ADD CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  ADD CONSTRAINT notification_outbox_target_type_check
    CHECK (target_type IS NULL OR target_type IN ('vendor', 'customer', 'store_user'));

-- idempotency_key UNIQUE (二重送信防止の核)
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_idempotency_key_unique
  ON pit_v24_poc.notification_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
