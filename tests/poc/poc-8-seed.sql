-- Sprint alpha-0 PoC 8 vendor portal inbox notification flow seed.
-- Fixed IDs are shared with scripts/poc-8-run.ts and poc-8-cleanup.sql.

GRANT USAGE ON SCHEMA pit_v24_poc TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA pit_v24_poc TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pit_v24_poc TO authenticated, anon;

INSERT INTO pit_v24_poc.companies (id, name)
VALUES ('00000008-0000-4000-8000-000000000001', 'poc8_company_A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendors (id, company_id, name)
VALUES (
  '00000008-0000-4000-8000-000000000101',
  '00000008-0000-4000-8000-000000000001',
  'poc8_vendor_A'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendor_users (id, company_id, vendor_id, email)
VALUES (
  '00000008-0000-4000-8000-000000000201',
  '00000008-0000-4000-8000-000000000001',
  '00000008-0000-4000-8000-000000000101',
  'poc-8-vendor-user@example.test'
)
ON CONFLICT (id) DO NOTHING;

WITH outbox_seed AS (
  SELECT
    n,
    'poc8-' || lpad(n::text, 3, '0') AS idempotency_key
  FROM generate_series(1, 5) AS series(n)
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
  '00000008-0000-4000-8000-000000000001'::uuid,
  idempotency_key,
  'vendor_portal.inbox',
  'vendor',
  '00000008-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'subject', 'PoC 8 notification ' || n,
    'body', 'PoC 8 inbox body ' || n
  ),
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
