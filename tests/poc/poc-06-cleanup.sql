-- Sprint alpha-0 PoC 6 vendor portal auth RLS leak cleanup.
-- Deletes only rows associated with the fixed UUIDs seeded by poc-06-seed.sql.

DELETE FROM pit_v24_poc.vendor_company_memberships
WHERE pit_v24_poc.vendor_company_memberships.id IN (
  '55555555-0000-0000-0000-000000000001'
);

DELETE FROM pit_v24_poc.vendor_users
WHERE pit_v24_poc.vendor_users.id IN (
  '44444444-0000-0000-0000-000000000001'
);

DELETE FROM pit_v24_poc.users
WHERE pit_v24_poc.users.id IN (
  '33333333-0000-0000-0000-000000000001'
);

DELETE FROM pit_v24_poc.vendors
WHERE pit_v24_poc.vendors.id IN (
  '22222222-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-000000000002'
);

DELETE FROM pit_v24_poc.audit_logs
WHERE pit_v24_poc.audit_logs.company_id IN (
  '11111111-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000002'
)
AND (
  pit_v24_poc.audit_logs.payload ->> 'id' IN (
    '22222222-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000002',
    '33333333-0000-0000-0000-000000000001'
  )
  OR pit_v24_poc.audit_logs.payload ->> 'company_id' IN (
    '11111111-0000-0000-0000-000000000001',
    '11111111-0000-0000-0000-000000000002'
  )
);

DELETE FROM pit_v24_poc.companies
WHERE pit_v24_poc.companies.id IN (
  '11111111-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000002'
);

DELETE FROM auth.users
WHERE auth.users.id IN (
  '33333333-0000-0000-0000-000000000001',
  '44444444-0000-0000-0000-000000000001'
);
