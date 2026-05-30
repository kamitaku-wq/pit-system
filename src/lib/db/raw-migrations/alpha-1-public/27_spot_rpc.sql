-- spec phase-handoff/phase-24-sprint-beta-day1-plan.md sub-task β:
--   1. spot invitation MVP RPC accepts/rejects pending spot invitations
--   2. applies after 26_spot_helper_rls.sql and follows the vendor RPC migration pattern
--   3. recon source: phase-handoff/phase-23-sprint-beta-recon-spot.md §2
--   4. error codes:
--      - 22023 invalid response
--      - P0002 not pending or status seed missing
--      - 42501 not vendor user or email mismatch (case c cross-tenant)
--      - 55P03 concurrent
--      - P0001 invalid transition
--   5. do not modify respond_to_transport_order or accept_invitation_and_revoke_others

CREATE OR REPLACE FUNCTION public.respond_to_spot_invitation(
  p_invitation_id uuid,
  p_response text,
  p_reason text DEFAULT NULL
) RETURNS TABLE(
  transport_order_id uuid, version int, invitation_id uuid,
  new_status_id uuid, history_id uuid,
  bound_vendor_id uuid, bound_vendor_user_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_to_id uuid; v_company_id uuid; v_from_status_id uuid;
  v_vendor_user_id uuid; v_vendor_id uuid; v_vendor_email text;
  v_invitee_email text; v_version int; v_status_id uuid; v_history_id uuid;
BEGIN
  IF p_response IS NULL OR p_response NOT IN ('accepted','rejected') THEN
    RAISE EXCEPTION 'invalid response value' USING ERRCODE = '22023';
  END IF;
  v_vendor_user_id := public.current_vendor_user_id();
  IF v_vendor_user_id IS NULL THEN
    RAISE EXCEPTION 'caller is not vendor user' USING ERRCODE = '42501';
  END IF;
  SELECT vendor_id, lower(email) INTO v_vendor_id, v_vendor_email
    FROM public.vendor_users
    WHERE id = v_vendor_user_id AND is_active = true AND deleted_at IS NULL;
  SELECT transport_order_id, lower(invitee_email)
    INTO v_to_id, v_invitee_email
    FROM public.transport_order_invitations
    WHERE id = p_invitation_id AND response = 'pending'
      AND vendor_id IS NULL AND invitee_email IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now());
  IF v_to_id IS NULL THEN
    RAISE EXCEPTION 'spot invitation not pending or not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_vendor_email IS DISTINCT FROM v_invitee_email THEN
    RAISE EXCEPTION 'spot invitation email mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_response = 'rejected' THEN
    UPDATE public.transport_order_invitations
      SET response='rejected', responded_at=now(),
          bound_vendor_id=v_vendor_id, bound_vendor_user_id=v_vendor_user_id
      WHERE id = p_invitation_id;
    SELECT version INTO v_version FROM public.transport_orders WHERE id = v_to_id;
    RETURN QUERY SELECT v_to_id, v_version, p_invitation_id, NULL::uuid, NULL::uuid, v_vendor_id, v_vendor_user_id;
    RETURN;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext(v_to_id::text)) THEN
    RAISE EXCEPTION 'transport_order % is being processed concurrently', v_to_id USING ERRCODE = '55P03';
  END IF;
  SELECT company_id, status_id INTO v_company_id, v_from_status_id
    FROM public.transport_orders WHERE id = v_to_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.transport_order_invitations
    WHERE transport_order_id=v_to_id AND is_winning_bid=true
  ) THEN
    RAISE EXCEPTION 'transport_order already has winning bid' USING ERRCODE = '55P03';
  END IF;
  SELECT id INTO v_status_id FROM public.statuses
    WHERE company_id=v_company_id AND status_type='transport' AND key='accepted' AND is_active=true
    LIMIT 1;
  IF v_status_id IS NULL THEN
    RAISE EXCEPTION 'accepted status not seeded for company' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.transport_order_invitations
    SET response='accepted', is_winning_bid=true, responded_at=now(),
        bound_vendor_id=v_vendor_id, bound_vendor_user_id=v_vendor_user_id
    WHERE id=p_invitation_id;
  UPDATE public.transport_order_invitations
    SET response='revoked', responded_at=now()
    WHERE transport_order_id=v_to_id AND id<>p_invitation_id AND response='pending';
  UPDATE public.transport_orders
    SET vendor_id=v_vendor_id, status_id=v_status_id, version=version+1, updated_at=now()
    WHERE id=v_to_id RETURNING version INTO v_version;
  INSERT INTO public.transport_order_status_history(
    company_id, transport_order_id, from_status_id, to_status_id, changed_by_user_id, reason
  ) VALUES (
    v_company_id, v_to_id, v_from_status_id, v_status_id, NULL,
    COALESCE(p_reason,'spot_vendor_accept')
  ) RETURNING id INTO v_history_id;
  RETURN QUERY SELECT v_to_id, v_version, p_invitation_id, v_status_id, v_history_id, v_vendor_id, v_vendor_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.respond_to_spot_invitation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_spot_invitation(uuid, text, text) TO authenticated;
