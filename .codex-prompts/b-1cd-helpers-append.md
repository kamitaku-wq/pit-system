# Phase B-1c + B-1d: 18_helper_functions.sql に 2 関数追記

## ゴール

既存ファイル `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` (現 86 行、5 helper 完成済) の **末尾を改変** して以下を追加:

1. **B-1c**: `redact_audit_payload(p_entity text, p_data jsonb)` — PoC #16 から public schema へ移植
2. **B-1d**: `accept_invitation_and_revoke_others(p_invitation_id uuid)` — advisory lock 化、ADR-0008
3. **GRANT 文を 7 関数分に拡張** (既存 5 + 新 2)

## 重要: 既存 5 関数 (current_user_company_id 等) は **触らない**

ファイル末尾の既存 5 GRANT 文ブロック (現 82-86 行) を **削除して** 拡張 7 GRANT 文に置き換える。先頭コメントと 5 関数定義はそのまま残す。

## B-1c: redact_audit_payload の正確な実装

PoC #16 (`src/lib/db/raw-migrations/poc-16-pii-redaction/poc16_01_function.sql`) を public schema 用に書き換える。

```sql
-- ---------------------------------------------------------------------------
-- B-1c: redact_audit_payload (PoC #16 移植)
-- 2 引数版: 5 entity (customers / vehicles / vendor_users / users / customer_reservation_tokens)
-- spec/data-model.md §11.2 (redaction policy)
-- audit_logs 自動記録 trigger より先に実装必須 (spec §17 line 1710)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redact_audit_payload(p_entity text, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
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
```

## B-1d: accept_invitation_and_revoke_others の正確な実装

spec §7.10.2 lines 919-921 + ADR-0008。advisory lock + 他招待 revoke + transport_orders.vendor_id 確定 + version++。

```sql
-- ---------------------------------------------------------------------------
-- B-1d: accept_invitation_and_revoke_others (advisory lock 化)
-- spec/data-model.md §7.10.2 lines 919-921 / ADR-0008
-- 案件単位招待の先着受注: 同一 transport_order の他招待を revoked 化、winning 設定
-- advisory lock で同時受注競合を防ぐ。55P03 (lock_not_available) 時は client retry 想定
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_invitation_and_revoke_others(p_invitation_id uuid)
RETURNS TABLE(transport_order_id uuid, version int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transport_order_id uuid;
  v_company_id uuid;
  v_vendor_id uuid;
  v_vendor_user_id uuid;
  v_new_version int;
BEGIN
  SELECT toi.transport_order_id, toi.company_id, toi.vendor_id
    INTO v_transport_order_id, v_company_id, v_vendor_id
  FROM public.transport_order_invitations toi
  WHERE toi.id = p_invitation_id
    AND toi.deleted_at IS NULL
    AND toi.response = 'pending';

  IF v_transport_order_id IS NULL THEN
    RAISE EXCEPTION 'invitation not found or not pending: %', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext(v_transport_order_id::text)) THEN
    RAISE EXCEPTION 'transport_order % is being processed concurrently', v_transport_order_id
      USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transport_order_invitations
    WHERE transport_order_id = v_transport_order_id
      AND is_winning_bid = true
  ) THEN
    RAISE EXCEPTION 'transport_order % already has winning bid', v_transport_order_id
      USING ERRCODE = '55P03';
  END IF;

  v_vendor_user_id := public.current_vendor_user_id();

  UPDATE public.transport_order_invitations
  SET response = 'accepted',
      is_winning_bid = true,
      responded_at = now(),
      bound_vendor_user_id = v_vendor_user_id,
      bound_at = now(),
      updated_at = now()
  WHERE id = p_invitation_id;

  UPDATE public.transport_order_invitations
  SET response = 'revoked',
      responded_at = now(),
      updated_at = now()
  WHERE transport_order_id = v_transport_order_id
    AND id <> p_invitation_id
    AND response = 'pending'
    AND deleted_at IS NULL;

  UPDATE public.transport_orders
  SET vendor_id = v_vendor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_transport_order_id
  RETURNING version INTO v_new_version;

  RETURN QUERY SELECT v_transport_order_id, v_new_version;
END;
$$;
```

## GRANT 文 (既存 5 を置換、7 文に拡張)

```sql
-- ---------------------------------------------------------------------------
-- GRANT EXECUTE
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.current_user_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_vendor_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_vendor_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_accessible_company_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redact_audit_payload(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_invitation_and_revoke_others(uuid) TO authenticated;
```

## 完了条件

- ファイル全体が ~230-240 行程度
- 7 関数すべて CREATE OR REPLACE で書かれる
- 7 GRANT 文がある
- 既存 5 関数定義は変更なし (先頭 80 行付近そのまま)
- typecheck / pnpm 実行はしない (Phase A-2 で sandbox spawn error 多発教訓)
