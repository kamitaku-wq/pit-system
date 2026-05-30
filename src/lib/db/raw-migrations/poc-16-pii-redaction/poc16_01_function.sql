-- PoC #16 PII redaction: redact_audit_payload 関数本体
-- spec/data-model.md §11.2 line 1226-1241 を pit_v24_poc に移植
-- 現状 poc12_18_helper_functions.sql line 48-52 は dummy stub (payload を素通し)
-- 本 PoC で実装本体に置換、4 entity (customers/vehicles/vendor_users/users) +
-- customer_reservation_tokens.token_hash 完全削除を実装

CREATE OR REPLACE FUNCTION pit_v24_poc.redact_audit_payload(p_entity text, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = pit_v24_poc
AS $$
DECLARE
  result jsonb := p_data;
  raw_email text;
BEGIN
  IF result IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_entity = 'customers' THEN
    IF result ? 'phone' AND (result->>'phone') IS NOT NULL THEN
      result := jsonb_set(result, '{phone}', to_jsonb('***' || right(result->>'phone', 4)));
    END IF;
    IF result ? 'email' AND (result->>'email') IS NOT NULL THEN
      raw_email := result->>'email';
      result := jsonb_set(
        result,
        '{email}',
        to_jsonb(left(raw_email, 1) || '***@' || split_part(raw_email, '@', 2))
      );
    END IF;

  ELSIF p_entity = 'vehicles' THEN
    IF result ? 'vin' AND (result->>'vin') IS NOT NULL THEN
      result := jsonb_set(result, '{vin}', to_jsonb('***' || right(result->>'vin', 6)));
    END IF;

  ELSIF p_entity IN ('vendor_users', 'users') THEN
    IF result ? 'email' AND (result->>'email') IS NOT NULL THEN
      raw_email := result->>'email';
      result := jsonb_set(
        result,
        '{email}',
        to_jsonb(left(raw_email, 1) || '***@' || split_part(raw_email, '@', 2))
      );
    END IF;

  ELSIF p_entity = 'customer_reservation_tokens' THEN
    IF result ? 'token_hash' THEN
      result := result - 'token_hash';
    END IF;
  END IF;

  RETURN result;
END;
$$;
