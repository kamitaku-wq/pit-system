-- Grant Supabase default roles access to pit_v24_poc (idempotent, PoC scope only).
GRANT USAGE ON SCHEMA pit_v24_poc TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA pit_v24_poc TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pit_v24_poc TO authenticated, anon;

INSERT INTO pit_v24_poc.companies (
  id,
  name
)
VALUES (
  '00000014-0000-4000-8000-000000000001',
  'poc14_company_A'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.users (
  id,
  company_id,
  role_id,
  email
)
VALUES (
  '00000014-0000-4000-8000-000000000101',
  '00000014-0000-4000-8000-000000000001',
  (
    SELECT id
    FROM pit_v24_poc.roles
    WHERE company_id IS NULL
      AND code = 'admin'
    LIMIT 1
  ),
  'poc14_admin@example.test'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendors (
  id,
  company_id,
  name
)
VALUES (
  '00000014-0000-4000-8000-0000000000a1',
  '00000014-0000-4000-8000-000000000001',
  'poc14_vendor_A'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendors (
  id,
  company_id,
  name
)
VALUES (
  '00000014-0000-4000-8000-0000000000b1',
  '00000014-0000-4000-8000-000000000001',
  'poc14_vendor_B'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendor_available_days (
  id,
  company_id,
  vendor_id,
  day_of_week
)
VALUES (
  '00000014-0000-4000-8000-000000000501',
  '00000014-0000-4000-8000-000000000001',
  '00000014-0000-4000-8000-0000000000a1',
  1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendor_available_days (
  id,
  company_id,
  vendor_id,
  day_of_week
)
VALUES (
  '00000014-0000-4000-8000-000000000505',
  '00000014-0000-4000-8000-000000000001',
  '00000014-0000-4000-8000-0000000000a1',
  5
)
ON CONFLICT (id) DO NOTHING;
