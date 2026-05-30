DELETE FROM pit_v24_poc.notification_outbox
WHERE idempotency_key LIKE 'poc3-%';

DELETE FROM pit_v24_poc.companies
WHERE id = '00000003-0000-4000-8000-000000000001';
