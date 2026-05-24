-- spec phase-handoff/phase-21-alpha-3-day4-16e-plan.md §2:
--   1. close_transport_order ends a transport_order when all invitations are rejected
--   2. called from respondToTransportOrder reject path (service wrapper closeTransportOrderOnAllRejected)
--   3. SECURITY DEFINER for RLS bypass; lookup terminal status by (company_id, status_type='transport', key='rejected')
--   4. terminal status is whatever per-tenant status row has is_terminal=true (matches Phase 19 RPC pattern)

CREATE OR REPLACE FUNCTION public.close_transport_order(p_transport_order_id uuid)
RETURNS TABLE(
  transport_order_id uuid,
  closed boolean,
  new_status_id uuid,
  history_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_from_status_id uuid;
  v_terminal_status_id uuid;
  v_accepted int;
  v_pending int;
  v_rejected int;
  v_history_id uuid;
BEGIN
  SELECT tro.company_id, tro.status_id
    INTO v_company_id, v_from_status_id
  FROM public.transport_orders tro
  WHERE tro.id = p_transport_order_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'transport_order not found: %', p_transport_order_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE response = 'accepted'),
    COUNT(*) FILTER (WHERE response = 'pending'),
    COUNT(*) FILTER (WHERE response = 'rejected')
  INTO v_accepted, v_pending, v_rejected
  FROM public.transport_order_invitations
  WHERE transport_order_id = p_transport_order_id;

  IF v_accepted > 0 OR v_pending > 0 OR v_rejected = 0 THEN
    RETURN QUERY SELECT p_transport_order_id, false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT s.id
    INTO v_terminal_status_id
  FROM public.statuses s
  WHERE s.company_id = v_company_id
    AND s.status_type = 'transport'
    AND s.key = 'rejected'
    AND s.is_terminal = true
    AND s.is_active = true
  LIMIT 1;

  IF v_terminal_status_id IS NULL THEN
    RAISE EXCEPTION 'terminal transport status not seeded for company %', v_company_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.transport_orders
     SET status_id = v_terminal_status_id,
         vendor_response = 'rejected',
         updated_at = now()
   WHERE id = p_transport_order_id;

  INSERT INTO public.transport_order_status_history (
    company_id, transport_order_id, from_status_id, to_status_id,
    changed_by_user_id, reason
  ) VALUES (
    v_company_id, p_transport_order_id, v_from_status_id, v_terminal_status_id,
    NULL, 'all invitations rejected (auto close)'
  ) RETURNING id INTO v_history_id;

  RETURN QUERY SELECT p_transport_order_id, true, v_terminal_status_id, v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_transport_order(uuid) TO authenticated;
