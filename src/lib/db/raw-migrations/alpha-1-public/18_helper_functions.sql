-- spec §14.2 deviations from alpha-1-public DDL (SQL is source of truth):
--   1. vendor_users links to auth via auth_user_id (not id); use is_active + deleted_at IS NULL
--   2. vendor_company_memberships uses (starts_on, ends_on) time window (no is_enabled column)
--   3. vendors join adds deleted_at IS NULL guard

CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT company_id
  FROM public.users
  WHERE id = auth.uid()
    AND is_active = true
    AND deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_vendor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT vendor_id
  FROM public.vendor_users
  WHERE auth_user_id = auth.uid()
    AND is_active = true
    AND deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_vendor_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM public.vendor_users
  WHERE auth_user_id = auth.uid()
    AND is_active = true
    AND deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.vendor_accessible_company_ids(p_vendor_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT company_id
  FROM public.vendors
  WHERE id = p_vendor_id
    AND deleted_at IS NULL
  UNION
  SELECT company_id
  FROM public.vendor_company_memberships
  WHERE vendor_id = p_vendor_id
    AND (starts_on IS NULL OR starts_on <= CURRENT_DATE)
    AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)
$$;

CREATE OR REPLACE FUNCTION public.vendor_invited_transport_order_ids(p_vendor_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT transport_order_id
  FROM public.transport_order_invitations
  WHERE vendor_id = p_vendor_id
    AND response NOT IN ('revoked', 'expired')
    AND deleted_at IS NULL
$$;

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
  v_vendor_id uuid;
  v_vendor_user_id uuid;
  v_new_version int;
BEGIN
  SELECT toi.transport_order_id, toi.vendor_id
    INTO v_transport_order_id, v_vendor_id
  FROM public.transport_order_invitations toi
  WHERE toi.id = p_invitation_id
    AND toi.deleted_at IS NULL
    AND toi.response = 'pending';

  IF v_transport_order_id IS NULL THEN
    RAISE EXCEPTION 'invitation not found or not pending: %', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  -- スポット招待 (vendor 未確定) は本関数スコープ外 (spec §7.10.2 line 943 別フロー)
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'invitation has no bound vendor (spot invitation flow)'
      USING ERRCODE = 'P0002';
  END IF;

  -- 認可ガード: caller が vendor user で、招待の vendor と一致すること
  v_vendor_user_id := public.current_vendor_user_id();
  IF v_vendor_user_id IS NULL THEN
    RAISE EXCEPTION 'caller is not an authenticated vendor user'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_users vu
    WHERE vu.id = v_vendor_user_id
      AND vu.vendor_id = v_vendor_id
      AND vu.is_active = true
      AND vu.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'caller vendor_user does not belong to invitation vendor'
      USING ERRCODE = '42501';
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
