BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{
  "sub": "00000014-0000-4000-8000-000000000101",
  "role": "authenticated",
  "company_id": "00000014-0000-4000-8000-000000000001",
  "app_role": "admin"
}';
SELECT set_config('request.jwt.claim.sub', '00000014-0000-4000-8000-000000000101', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.company_id', '00000014-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.app_role', 'admin', true);

DO $poc14$
DECLARE
  v_company_a CONSTANT uuid := '00000014-0000-4000-8000-000000000001';
  v_vendor_a CONSTANT uuid := '00000014-0000-4000-8000-0000000000a1';
  v_vendor_b CONSTANT uuid := '00000014-0000-4000-8000-0000000000b1';
  monday_vendor_ids uuid[];
BEGIN
  ASSERT (
    SELECT count(*)
    FROM pit_v24_poc.vendor_available_days
    WHERE company_id = v_company_a
      AND vendor_id = v_vendor_a
  ) = 2,
    'PoC #14 baseline failed: vendor_A should have exactly 2 available day rows';

  ASSERT (
    SELECT count(*)
    FROM pit_v24_poc.vendors AS v
    JOIN pit_v24_poc.vendor_available_days AS vad
      ON vad.vendor_id = v.id
     AND vad.company_id = v.company_id
    WHERE v.company_id = v_company_a
      AND v.id = v_vendor_a
      AND vad.day_of_week = 3
  ) = 0,
    'PoC #14 Wednesday exclusion failed: vendor_A should not be available on dow=3';

  ASSERT (
    SELECT count(*)
    FROM pit_v24_poc.vendors AS v
    JOIN pit_v24_poc.vendor_available_days AS vad
      ON vad.vendor_id = v.id
     AND vad.company_id = v.company_id
    WHERE v.company_id = v_company_a
      AND v.id = v_vendor_a
      AND vad.day_of_week = 1
  ) = 1,
    'PoC #14 Monday inclusion failed: vendor_A should be available on dow=1';

  SELECT coalesce(array_agg(v.id ORDER BY v.id), ARRAY[]::uuid[])
  INTO monday_vendor_ids
  FROM pit_v24_poc.vendors AS v
  JOIN pit_v24_poc.vendor_available_days AS vad
    ON vad.vendor_id = v.id
   AND vad.company_id = v.company_id
  WHERE v.company_id = v_company_a
    AND v.id IN (v_vendor_a, v_vendor_b)
    AND vad.day_of_week = 1;

  ASSERT monday_vendor_ids = ARRAY[v_vendor_a],
    'PoC #14 multi-vendor failed: Monday query should return vendor_A only';
END
$poc14$;

COMMIT;
