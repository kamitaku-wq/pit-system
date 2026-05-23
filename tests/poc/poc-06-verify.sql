-- Sprint alpha-0 PoC 6 vendor portal auth RLS leak verification.
-- The SET LOCAL request.jwt.claims assignments follow the Supabase auth.uid()
-- test pattern from prior PoCs. Each assertion raises NOTICE with "OK:" on pass.

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  seen_vendor_ids uuid[];
  expected_vendor_ids uuid[] := ARRAY['22222222-0000-0000-0000-000000000001'::uuid];
BEGIN
  SELECT COALESCE(array_agg(pit_v24_poc.vendors.id ORDER BY pit_v24_poc.vendors.id), ARRAY[]::uuid[])
  INTO seen_vendor_ids
  FROM pit_v24_poc.vendors;

  IF seen_vendor_ids = expected_vendor_ids THEN
    RAISE NOTICE 'OK: admin seat sees only own company vendors';
  ELSE
    RAISE EXCEPTION
      'FAIL: admin seat sees %, expected only %',
      seen_vendor_ids,
      expected_vendor_ids;
  END IF;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  vendor_count integer;
  company_id uuid;
BEGIN
  SELECT count(*)::integer
  INTO vendor_count
  FROM pit_v24_poc.vendors;

  SELECT pit_v24_poc.current_user_company_id()
  INTO company_id;

  IF vendor_count = 0 AND company_id IS NULL THEN
    RAISE NOTICE 'OK: vendor_user seat sees 0 rows from vendors';
  ELSE
    RAISE EXCEPTION
      'FAIL: vendor_user seat saw % vendors and current_user_company_id() = %, expected 0 and NULL',
      vendor_count,
      company_id;
  END IF;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE anon;

DO $$
DECLARE
  vendor_count integer;
BEGIN
  SELECT count(*)::integer
  INTO vendor_count
  FROM pit_v24_poc.vendors;

  IF vendor_count = 0 THEN
    RAISE NOTICE 'OK: anon seat sees 0 rows from vendors';
  ELSE
    RAISE EXCEPTION 'FAIL: anon seat saw % vendors, expected 0', vendor_count;
  END IF;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  actual_vendor_id uuid;
  expected_vendor_id uuid := '22222222-0000-0000-0000-000000000001'::uuid;
BEGIN
  SELECT pit_v24_poc.current_vendor_id()
  INTO actual_vendor_id;

  IF actual_vendor_id = expected_vendor_id THEN
    RAISE NOTICE 'OK: current_vendor_id works for vendor_user seat';
  ELSE
    RAISE EXCEPTION
      'FAIL: current_vendor_id() returned %, expected %',
      actual_vendor_id,
      expected_vendor_id;
  END IF;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  actual_company_ids uuid[];
  expected_company_ids uuid[] := ARRAY['11111111-0000-0000-0000-000000000001'::uuid];
BEGIN
  SELECT COALESCE(array_agg(company_id ORDER BY company_id), ARRAY[]::uuid[])
  INTO actual_company_ids
  FROM pit_v24_poc.vendor_accessible_company_ids() AS company_id;

  IF actual_company_ids = expected_company_ids THEN
    RAISE NOTICE 'OK: vendor_accessible_company_ids works for vendor_user seat';
  ELSE
    RAISE EXCEPTION
      'FAIL: vendor_accessible_company_ids() returned %, expected %',
      actual_company_ids,
      expected_company_ids;
  END IF;
END $$;
COMMIT;
