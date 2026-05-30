-- spec §7.10 / phase-handoff/phase-19-alpha-3-day2-16c-plan.md:
--   1. registered vendor accept/reject responses are handled by one SECURITY DEFINER RPC
--   2. accept reuses accept_invitation_and_revoke_others for auth, advisory lock,
--      invitation winning/revoke updates, transport_orders.vendor_id, and version bump
--   3. reject updates only the caller's invitation; all-rejected order closure is 16-E scope

-- ---------------------------------------------------------------------------
-- Phase 19 / 16-C: respond_to_transport_order
-- Single RPC for registered vendor invitation response.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.respond_to_transport_order(
  p_invitation_id uuid,
  p_response text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(
  transport_order_id uuid,
  version int,
  invitation_id uuid,
  new_status_id uuid,
  history_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transport_order_id uuid;
  v_invitation_vendor_id uuid;
  v_vendor_user_id uuid;
  v_vendor_user_vendor_id uuid;
  v_version int;
  v_company_id uuid;
  v_from_status_id uuid;
  v_accepted_status_id uuid;
  v_history_id uuid;
BEGIN
  IF p_response IS NULL OR p_response NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid response value'
      USING ERRCODE = '22023';
  END IF;

  SELECT toi.transport_order_id, toi.vendor_id
    INTO v_transport_order_id, v_invitation_vendor_id
  FROM public.transport_order_invitations toi
  WHERE toi.id = p_invitation_id
    AND toi.response = 'pending';

  IF v_transport_order_id IS NULL THEN
    RAISE EXCEPTION 'invitation not pending or not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_response = 'accepted' THEN
    -- spec phase-handoff/phase-19 §accept-path: reuse existing atomic accept helper.
    SELECT accepted.transport_order_id, accepted.version
      INTO v_transport_order_id, v_version
    FROM public.accept_invitation_and_revoke_others(p_invitation_id) AS accepted;

    SELECT s.id
      INTO v_accepted_status_id
    FROM public.statuses s
    WHERE s.company_id = (
        SELECT tro.company_id
        FROM public.transport_orders tro
        WHERE tro.id = v_transport_order_id
      )
      AND s.status_type = 'transport'
      AND s.key = 'accepted'
      AND s.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'accepted status not seeded for company'
        USING ERRCODE = 'P0002';
    END IF;

    SELECT tro.company_id, tro.status_id
      INTO v_company_id, v_from_status_id
    FROM public.transport_orders tro
    WHERE tro.id = v_transport_order_id;

    UPDATE public.transport_orders tro
    SET status_id = v_accepted_status_id
    WHERE tro.id = v_transport_order_id;

    INSERT INTO public.transport_order_status_history (
      company_id,
      transport_order_id,
      from_status_id,
      to_status_id,
      changed_by_user_id,
      reason
    )
    VALUES (
      v_company_id,
      v_transport_order_id,
      v_from_status_id,
      v_accepted_status_id,
      NULL,
      COALESCE(p_reason, 'vendor_accept')
    )
    RETURNING id INTO v_history_id;

    RETURN QUERY
      SELECT v_transport_order_id, v_version, p_invitation_id,
             v_accepted_status_id, v_history_id;
    RETURN;
  END IF;

  -- spec phase-handoff/phase-19 §reject-path: reject does not call accept helper.
  v_vendor_user_id := public.current_vendor_user_id();
  IF v_vendor_user_id IS NULL THEN
    RAISE EXCEPTION 'caller is not vendor user'
      USING ERRCODE = '42501';
  END IF;

  SELECT vu.vendor_id
    INTO v_vendor_user_vendor_id
  FROM public.vendor_users vu
  WHERE vu.id = v_vendor_user_id
    AND vu.is_active = true
    AND vu.deleted_at IS NULL;

  IF v_vendor_user_vendor_id IS NULL THEN
    RAISE EXCEPTION 'caller is not vendor user'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation_vendor_id IS DISTINCT FROM v_vendor_user_vendor_id THEN
    RAISE EXCEPTION 'vendor mismatch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.transport_order_invitations toi
  SET response = 'rejected',
      responded_at = now(),
      bound_vendor_user_id = v_vendor_user_id
  WHERE toi.id = p_invitation_id;

  SELECT tro.version
    INTO v_version
  FROM public.transport_orders tro
  WHERE tro.id = v_transport_order_id;

  RETURN QUERY
    SELECT v_transport_order_id, v_version, p_invitation_id,
           NULL::uuid, NULL::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.respond_to_transport_order(uuid, text, text) TO authenticated;
