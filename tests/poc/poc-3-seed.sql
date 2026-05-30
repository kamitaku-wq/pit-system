-- Sprint alpha-0 PoC 3 notification outbox SKIP LOCKED dispatcher seed.
-- Fixed IDs are shared with scripts/poc-3-run.ts and poc-3-cleanup.sql.

GRANT USAGE ON SCHEMA pit_v24_poc TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA pit_v24_poc TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pit_v24_poc TO authenticated, anon;

INSERT INTO pit_v24_poc.companies (id, name)
VALUES ('00000003-0000-4000-8000-000000000001', 'poc3_company_A')
ON CONFLICT (id) DO NOTHING;

WITH outbox_seed AS (
  SELECT
    n,
    'poc3-' || lpad(n::text, 3, '0') AS idempotency_key
  FROM generate_series(1, 100) AS series(n)
)
INSERT INTO pit_v24_poc.notification_outbox (
  company_id,
  idempotency_key,
  event_type,
  target_type,
  target_id,
  payload,
  status,
  attempts,
  max_attempts,
  next_attempt_at,
  sent_at,
  last_error,
  scheduled_at,
  processing_started_at
)
SELECT
  '00000003-0000-4000-8000-000000000001'::uuid,
  idempotency_key,
  'test',
  'vendor',
  '00000000-0000-0000-0000-000000000001'::uuid,
  '{}'::jsonb,
  'pending',
  0,
  5,
  now(),
  NULL,
  NULL,
  NULL,
  NULL
FROM outbox_seed
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
