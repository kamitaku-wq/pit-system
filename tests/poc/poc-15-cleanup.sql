-- Sprint alpha-0 PoC 15 first accept wins cleanup.
-- Deletes only rows associated with the fixed UUIDs seeded by poc-15-seed.sql.

WITH ids AS (
  SELECT
    ('00000015-0000-4000-8000-00000001' || lpad(n::text, 4, '0'))::uuid AS vendor_id,
    ('00000015-0000-4000-8000-00000002' || lpad(n::text, 4, '0'))::uuid AS invitation_id
  FROM generate_series(1, 50) AS series(n)
)
DELETE FROM pit_v24_poc.vendor_selection_logs
WHERE transport_order_id = '00000015-0000-4000-8000-000000000201'
   OR invitation_id IN (SELECT invitation_id FROM ids)
   OR vendor_id IN (SELECT vendor_id FROM ids);

DELETE FROM pit_v24_poc.transport_order_invitations
WHERE transport_order_id = '00000015-0000-4000-8000-000000000201'
   OR id IN (
     SELECT ('00000015-0000-4000-8000-00000002' || lpad(n::text, 4, '0'))::uuid
     FROM generate_series(1, 50) AS series(n)
   );

DELETE FROM pit_v24_poc.transport_order_vendor_attempts
WHERE transport_order_id = '00000015-0000-4000-8000-000000000201'
   OR vendor_id IN (
     SELECT ('00000015-0000-4000-8000-00000001' || lpad(n::text, 4, '0'))::uuid
     FROM generate_series(1, 50) AS series(n)
   );

DELETE FROM pit_v24_poc.transport_orders
WHERE id = '00000015-0000-4000-8000-000000000201';

DELETE FROM pit_v24_poc.vendor_company_memberships
WHERE vendor_id IN (
  SELECT ('00000015-0000-4000-8000-00000001' || lpad(n::text, 4, '0'))::uuid
  FROM generate_series(1, 50) AS series(n)
);

DELETE FROM pit_v24_poc.vendor_users
WHERE vendor_id IN (
  SELECT ('00000015-0000-4000-8000-00000001' || lpad(n::text, 4, '0'))::uuid
  FROM generate_series(1, 50) AS series(n)
);

DELETE FROM pit_v24_poc.vendors
WHERE name LIKE 'poc15_%'
   OR id IN (
     SELECT ('00000015-0000-4000-8000-00000001' || lpad(n::text, 4, '0'))::uuid
     FROM generate_series(1, 50) AS series(n)
   );

DELETE FROM pit_v24_poc.users
WHERE id = '00000015-0000-4000-8000-000000000101'
   OR email = 'poc-15-admin@example.test';

DELETE FROM pit_v24_poc.audit_logs
WHERE company_id = '00000015-0000-4000-8000-000000000001';

DELETE FROM pit_v24_poc.companies
WHERE id = '00000015-0000-4000-8000-000000000001'
   OR name LIKE 'poc15_%';

DELETE FROM auth.users
WHERE id = '00000015-0000-4000-8000-000000000101'
   OR email = 'poc-15-admin@example.test';
