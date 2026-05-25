-- Phase 27-A: 2 fixes for E2E vendor portal flow.
-- alpha-1-public 27 ファイルは invariant により touch 不可 → post で REPLACE する。

-- ---------------------------------------------------------------------------
-- Fix 1: accept_invitation_and_revoke_others の ambiguous column reference
--   18_helper_functions.sql の関数本体で transport_order_invitations への参照が
--   un-qualified で、RETURNS TABLE(transport_order_id ...) の OUT 列と衝突して
--   "column reference \"transport_order_id\" is ambiguous" を吐いていた。
--   全テーブル参照を toi/tro alias で qualify する。
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
  v_new_version int;
BEGIN
  SELECT toi.transport_order_id, toi.vendor_id
    INTO v_transport_order_id, v_vendor_id
  FROM public.transport_order_invitations toi
  WHERE toi.id = p_invitation_id
    AND toi.response = 'pending';

  IF v_transport_order_id IS NULL THEN
    RAISE EXCEPTION 'invitation not pending or not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext(v_transport_order_id::text)) THEN
    RAISE EXCEPTION 'transport_order % is being processed concurrently', v_transport_order_id
      USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transport_order_invitations toi2
    WHERE toi2.transport_order_id = v_transport_order_id
      AND toi2.is_winning_bid = true
  ) THEN
    RAISE EXCEPTION 'transport_order % already has winning bid', v_transport_order_id
      USING ERRCODE = '55P03';
  END IF;

  UPDATE public.transport_order_invitations toi
  SET response = 'accepted',
      is_winning_bid = true,
      responded_at = now(),
      bound_vendor_id = v_vendor_id
  WHERE toi.id = p_invitation_id;

  UPDATE public.transport_order_invitations toi
  SET response = 'revoked',
      responded_at = now()
  WHERE toi.transport_order_id = v_transport_order_id
    AND toi.id <> p_invitation_id
    AND toi.response = 'pending';

  UPDATE public.transport_orders tro
  SET vendor_id = v_vendor_id,
      version = tro.version + 1,
      updated_at = now()
  WHERE tro.id = v_transport_order_id
  RETURNING tro.version INTO v_new_version;

  RETURN QUERY SELECT v_transport_order_id, v_new_version;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation_and_revoke_others(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_invitation_and_revoke_others(uuid) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- Fix 2: spot vendor の transport_order_invitations 可視性
--   26_spot_helper_rls.sql の EXISTS branch で
--     vu.id = current_vendor_user_id() AND vu.vendor_id = current_vendor_id()
--   と書いていたが、current_vendor_id() は同じ vendor_users 行から vendor_id を
--   返すため redundant。さらに何らかの理由で current_vendor_id() が解決され
--   なくなった場合に spot vendor が onboarding 後も自分の invitation を見れなく
--   なる。redundant 条件を外し、email match と is_active を主条件とする。
--   vendor_invited_transport_order_ids も同様に。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.vendor_invited_transport_order_ids(p_vendor_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT transport_order_id
  FROM public.transport_order_invitations
  WHERE (
    vendor_id = p_vendor_id
    OR bound_vendor_id = p_vendor_id
    OR (
      vendor_id IS NULL
      AND invitee_email IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND EXISTS (
        SELECT 1 FROM public.vendor_users vu
        WHERE vu.id = public.current_vendor_user_id()
          AND vu.is_active = true
          AND vu.deleted_at IS NULL
          AND lower(vu.email) = lower(transport_order_invitations.invitee_email)
      )
    )
  )
  AND response NOT IN ('revoked', 'expired')
$$;

GRANT EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) FROM PUBLIC, anon;

DROP POLICY IF EXISTS vendor_select ON public.transport_order_invitations;
CREATE POLICY vendor_select ON public.transport_order_invitations
  FOR SELECT TO authenticated
  USING (
    vendor_id = public.current_vendor_id()
    OR bound_vendor_id = public.current_vendor_id()
    OR (
      vendor_id IS NULL
      AND invitee_email IS NOT NULL
      AND response NOT IN ('revoked', 'expired')
      AND (expires_at IS NULL OR expires_at > now())
      AND EXISTS (
        SELECT 1 FROM public.vendor_users vu
        WHERE vu.id = public.current_vendor_user_id()
          AND vu.is_active = true
          AND vu.deleted_at IS NULL
          AND lower(vu.email) = lower(transport_order_invitations.invitee_email)
      )
    )
  );
