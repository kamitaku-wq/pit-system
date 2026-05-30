DO $poc16$
BEGIN
  ASSERT (
    pit_v24_poc.redact_audit_payload('customers', '{"phone":"0312345678","name":"Alice"}'::jsonb) ->> 'phone'
  ) = '***5678',
    'PoC #16 customers phone mask failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('customers', '{"email":"alice@example.com","name":"Alice"}'::jsonb) ->> 'email'
  ) = 'a***@example.com',
    'PoC #16 customers email mask failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('customers', '{"phone":"0312345678","name":"Alice"}'::jsonb) ->> 'name'
  ) = 'Alice',
    'PoC #16 customers name passthrough failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('vehicles', '{"vin":"JT2BF22K1W0123456","model":"Prius"}'::jsonb) ->> 'vin'
  ) = '***123456',
    'PoC #16 vehicles vin mask failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('vehicles', '{"vin":"JT2BF22K1W0123456","model":"Prius"}'::jsonb) ->> 'model'
  ) = 'Prius',
    'PoC #16 vehicles model passthrough failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('vendor_users', '{"email":"bob@vendor.co.jp","name":"Bob"}'::jsonb) ->> 'email'
  ) = 'b***@vendor.co.jp',
    'PoC #16 vendor_users email mask failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('vendor_users', '{"email":"bob@vendor.co.jp","name":"Bob"}'::jsonb) ->> 'name'
  ) = 'Bob',
    'PoC #16 vendor_users name passthrough failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('users', '{"email":"carol@shop.jp","role":"admin"}'::jsonb) ->> 'email'
  ) = 'c***@shop.jp',
    'PoC #16 users email mask failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('users', '{"email":"carol@shop.jp","role":"admin"}'::jsonb) ->> 'role'
  ) = 'admin',
    'PoC #16 users role passthrough failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('customer_reservation_tokens', '{"token_hash":"abc123","customer_id":42}'::jsonb) ? 'token_hash'
  ) = false,
    'PoC #16 customer_reservation_tokens token_hash removal failed';

  ASSERT (
    pit_v24_poc.redact_audit_payload('customer_reservation_tokens', '{"token_hash":"abc123","customer_id":42}'::jsonb) ->> 'customer_id'
  ) = '42',
    'PoC #16 customer_reservation_tokens customer_id passthrough failed';

  ASSERT pit_v24_poc.redact_audit_payload('unknown_table', '{"foo":"bar"}'::jsonb) = '{"foo":"bar"}'::jsonb,
    'PoC #16 unknown entity passthrough failed';
  ASSERT pit_v24_poc.redact_audit_payload('customers', NULL) IS NULL,
    'PoC #16 null payload safety failed';
  ASSERT pit_v24_poc.redact_audit_payload('customers', '{"name":"NoPII"}'::jsonb) ->> 'name' = 'NoPII',
    'PoC #16 missing field safety failed';

  RAISE NOTICE 'PoC #16 redact_audit_payload: all assertions passed';
END
$poc16$;
