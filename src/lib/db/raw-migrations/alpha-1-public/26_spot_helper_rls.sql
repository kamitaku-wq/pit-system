-- Phase 24 Sprint β Day 1
-- spec: phase-handoff/phase-24-sprint-beta-day1-plan.md sub-task α
-- Extends 18_helper_functions.sql vendor_invited_transport_order_ids and
-- 19_rls_policies.sql vendor_select
-- Backward-compatible super-set: registered vendor visibility preserved;
-- adds bound_vendor_id and spot email-match branches

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
          AND vu.vendor_id = p_vendor_id
          AND vu.is_active = true
          AND vu.deleted_at IS NULL
          AND lower(vu.email) = lower(transport_order_invitations.invitee_email)
      )
    )
  )
  AND response NOT IN ('revoked', 'expired')
$$;

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
          AND vu.vendor_id = public.current_vendor_id()
          AND vu.is_active = true
          AND vu.deleted_at IS NULL
          AND lower(vu.email) = lower(transport_order_invitations.invitee_email)
      )
    )
  );

GRANT EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) FROM PUBLIC, anon;
