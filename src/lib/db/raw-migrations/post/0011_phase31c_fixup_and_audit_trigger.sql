-- Phase 31-C: admin_vendor_invitations fixup + audit trigger
-- Plan: phase-handoff/phase-35-phase-31-c-plan.md (D-1 / D-2 / D-7 / D-11)
--
-- 変更内容:
--   (a) duplicate-check 拡張 (D-1): WHERE status IN ('pending','sent') に拡張
--       既存 sent 重複行は grep + test fixture で無いことを確認済 (Phase 31-C plan R1)
--   (b) last_resent_at 列追加 (D-7): resend 60s rate limit 用
--   (c) redact_audit_payload に admin_vendor_invitations branch 追加 (D-2)
--       post を redact_audit_payload の唯一の source of truth とする運用 (ADR-0010 補項)
--       alpha-1-public/18_helper_functions.sql の base 定義に上書き追加
--   (d) trg_audit_admin_vendor_invitations trigger 追加 (D-11)
--       23_record_audit_log.sql の 9-trigger pattern 踏襲、INSERT/UPDATE/DELETE 監査
--
-- 適用順: db:setup では pre → alpha → drizzle → post の順で post が最後 → 安全に上書き可能

-- ---------------------------------------------------------------------------
-- (a) duplicate-check 拡張 (D-1)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_dup_count int;
BEGIN
  SELECT count(*) INTO v_dup_count FROM (
    SELECT vendor_id, email
    FROM public.admin_vendor_invitations
    WHERE status IN ('pending', 'sent')
    GROUP BY vendor_id, email
    HAVING count(*) > 1
  ) dups;
  IF v_dup_count > 0 THEN
    RAISE NOTICE 'WARN: % duplicate pending/sent invitations exist (vendor_id, email). Resolve before relying on UNIQUE constraint.', v_dup_count;
  END IF;
END $$;

DROP INDEX IF EXISTS admin_vendor_invitations_pending_unique;
CREATE UNIQUE INDEX admin_vendor_invitations_pending_unique
  ON public.admin_vendor_invitations (vendor_id, email)
  WHERE status IN ('pending', 'sent');

-- ---------------------------------------------------------------------------
-- (b) last_resent_at 列追加 (D-7)
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_vendor_invitations
  ADD COLUMN IF NOT EXISTS last_resent_at timestamptz;

-- ---------------------------------------------------------------------------
-- (c) redact_audit_payload 拡張 (D-2)
-- alpha-1-public/18_helper_functions.sql の 5 entity 版に admin_vendor_invitations
-- branch を追加した最新版で上書き。post を SoT とする運用 (ADR-0010 補項)。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redact_audit_payload(p_entity text, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb := p_data;
  raw_email text;
  raw_name text;
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

  ELSIF p_entity = 'admin_vendor_invitations' THEN
    -- Phase 31-C: email/name を PII として redaction (ADR-0009)
    IF result ? 'email' AND (result->>'email') IS NOT NULL THEN
      raw_email := result->>'email';
      result := jsonb_set(
        result,
        '{email}',
        to_jsonb(left(raw_email, 1) || '***@' || split_part(raw_email, '@', 2))
      );
    END IF;
    IF result ? 'name' AND (result->>'name') IS NOT NULL THEN
      raw_name := result->>'name';
      result := jsonb_set(
        result,
        '{name}',
        to_jsonb(left(raw_name, 1) || '***')
      );
    END IF;
    -- token_hash は完全除去 (招待 token 漏洩防止)
    IF result ? 'token_hash' THEN
      result := result - 'token_hash';
    END IF;
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redact_audit_payload(text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (d) trg_audit_admin_vendor_invitations trigger (D-11)
-- 23_record_audit_log.sql の 9-trigger pattern 踏襲
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_audit_admin_vendor_invitations ON public.admin_vendor_invitations;
CREATE TRIGGER trg_audit_admin_vendor_invitations
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_vendor_invitations
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
