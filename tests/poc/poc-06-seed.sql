-- Sprint alpha-0 PoC 6 vendor portal auth RLS leak seed.
-- Fixed IDs are shared with poc-06-verify.sql and poc-06-cleanup.sql.
-- Assumption: auth.users exists in the Supabase auth schema. The pit_v24_poc
-- tables do not FK to auth.users, but this PoC seeds matching auth rows because
-- vendor portal auth behavior is keyed by auth.uid() = users/vendor_users.id.

-- Grant Supabase default roles access to pit_v24_poc (idempotent, PoC scope only).
GRANT USAGE ON SCHEMA pit_v24_poc TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA pit_v24_poc TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pit_v24_poc TO authenticated, anon;

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
VALUES
  (
    '33333333-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'poc-06-admin@example.test',
    '',
    now(),
    now(),
    now()
  ),
  (
    '44444444-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'poc-06-vendor-user@example.test',
    '',
    now(),
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.companies (id, name)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'PoC 06 Company A'),
  ('11111111-0000-0000-0000-000000000002', 'PoC 06 Company B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendors (id, company_id, name)
VALUES
  (
    '22222222-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000001',
    'PoC 06 Vendor X'
  ),
  (
    '22222222-0000-0000-0000-000000000002',
    '11111111-0000-0000-0000-000000000002',
    'PoC 06 Vendor Y'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.users (id, company_id, email)
VALUES (
  '33333333-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000001',
  'poc-06-admin@example.test'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendor_users (id, company_id, vendor_id, email)
VALUES (
  '44444444-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-000000000001',
  'poc-06-vendor-user@example.test'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pit_v24_poc.vendor_company_memberships (id, company_id, vendor_id, is_shared)
VALUES (
  '55555555-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-000000000001',
  false
)
ON CONFLICT (id) DO NOTHING;
