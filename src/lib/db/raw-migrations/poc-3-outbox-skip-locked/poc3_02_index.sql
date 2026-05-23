-- PoC #3 outbox retry: dispatcher 取得クエリ用 partial index
-- spec §8.1 line 1022-1023

CREATE INDEX IF NOT EXISTS notification_outbox_dispatch_idx
  ON pit_v24_poc.notification_outbox (next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS notification_outbox_scheduled_idx
  ON pit_v24_poc.notification_outbox (scheduled_at)
  WHERE scheduled_at IS NOT NULL;
