-- Sprint alpha-0 PoC 8 vendor portal inbox notification flow cleanup.
-- Deletes only rows associated with the fixed UUIDs seeded by poc-8-seed.sql.

DELETE FROM pit_v24_poc.vendor_portal_inbox
WHERE company_id = '00000008-0000-4000-8000-000000000001'
   OR vendor_id = '00000008-0000-4000-8000-000000000101'
   OR vendor_user_id = '00000008-0000-4000-8000-000000000201'
   OR notification_outbox_id IN (
     SELECT id
     FROM pit_v24_poc.notification_outbox
     WHERE idempotency_key LIKE 'poc8-%'
   );

DELETE FROM pit_v24_poc.notification_outbox
WHERE idempotency_key LIKE 'poc8-%';

DELETE FROM pit_v24_poc.vendor_users
WHERE id = '00000008-0000-4000-8000-000000000201';

DELETE FROM pit_v24_poc.vendors
WHERE id = '00000008-0000-4000-8000-000000000101';

DELETE FROM pit_v24_poc.audit_logs
WHERE company_id = '00000008-0000-4000-8000-000000000001';

DELETE FROM pit_v24_poc.companies
WHERE id = '00000008-0000-4000-8000-000000000001';
