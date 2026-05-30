-- Sprint alpha-0 PoC 15 first accept wins seed.
-- Fixed IDs are shared with scripts/poc-15-run.ts and poc-15-cleanup.sql.

GRANT USAGE ON SCHEMA pit_v24_poc TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA pit_v24_poc TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pit_v24_poc TO authenticated, anon;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
VALUES (
  '00000015-0000-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'poc-15-admin@example.test',
  '',
  now(),
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
SET aud = EXCLUDED.aud, role = EXCLUDED.role, email = EXCLUDED.email, updated_at = now();

INSERT INTO pit_v24_poc.companies (id, name)
VALUES ('00000015-0000-4000-8000-000000000001', 'poc15_company_A')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, updated_at = now(), deleted_at = NULL;

INSERT INTO pit_v24_poc.users (id, company_id, role_id, email)
VALUES (
  '00000015-0000-4000-8000-000000000101',
  '00000015-0000-4000-8000-000000000001',
  (
    SELECT id
    FROM pit_v24_poc.roles
    WHERE company_id IS NULL AND code = 'admin'
    LIMIT 1
  ),
  'poc-15-admin@example.test'
)
ON CONFLICT (id) DO UPDATE
SET company_id = EXCLUDED.company_id,
    role_id = EXCLUDED.role_id,
    email = EXCLUDED.email,
    updated_at = now(),
    deleted_at = NULL;

INSERT INTO pit_v24_poc.transport_orders (
  id, company_id, service_ticket_id, reservation_id, movement_type, tow_required
)
VALUES (
  '00000015-0000-4000-8000-000000000201',
  '00000015-0000-4000-8000-000000000001',
  NULL,
  NULL,
  'carrier',
  false
)
ON CONFLICT (id) DO UPDATE
SET company_id = EXCLUDED.company_id,
    service_ticket_id = EXCLUDED.service_ticket_id,
    reservation_id = EXCLUDED.reservation_id,
    movement_type = EXCLUDED.movement_type,
    tow_required = EXCLUDED.tow_required,
    updated_at = now();

WITH vendor_seed AS (
  SELECT n, ('00000015-0000-4000-8000-00000001' || lpad(n::text, 4, '0'))::uuid AS id
  FROM generate_series(1, 50) AS series(n)
)
INSERT INTO pit_v24_poc.vendors (id, company_id, name)
SELECT id, '00000015-0000-4000-8000-000000000001', 'poc15_vendor_' || lpad(n::text, 2, '0')
FROM vendor_seed
ON CONFLICT (id) DO UPDATE
SET company_id = EXCLUDED.company_id, name = EXCLUDED.name, updated_at = now(), deleted_at = NULL;

WITH invitation_seed AS (
  SELECT
    n,
    ('00000015-0000-4000-8000-00000001' || lpad(n::text, 4, '0'))::uuid AS vendor_id,
    ('00000015-0000-4000-8000-00000002' || lpad(n::text, 4, '0'))::uuid AS invitation_id
  FROM generate_series(1, 50) AS series(n)
)
INSERT INTO pit_v24_poc.transport_order_invitations (
  id, company_id, transport_order_id, vendor_id, invited_by_user_id,
  response, is_winning_bid, responded_at, deleted_at
)
SELECT
  invitation_id,
  '00000015-0000-4000-8000-000000000001',
  '00000015-0000-4000-8000-000000000201',
  vendor_id,
  '00000015-0000-4000-8000-000000000101',
  'pending',
  false,
  NULL,
  NULL
FROM invitation_seed
ON CONFLICT (id) DO UPDATE
SET company_id = EXCLUDED.company_id,
    transport_order_id = EXCLUDED.transport_order_id,
    vendor_id = EXCLUDED.vendor_id,
    invited_by_user_id = EXCLUDED.invited_by_user_id,
    response = EXCLUDED.response,
    is_winning_bid = EXCLUDED.is_winning_bid,
    responded_at = EXCLUDED.responded_at,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = now();
