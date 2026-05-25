# Phase 23 / Sprint β Recon: spot invitation flow

## 1. Phase 21 recon からの差分・追加発見

- listed files all exist; `[id]` route required PowerShell `-LiteralPath` because `[id]` is a wildcard pattern.
- Phase 22 added `close_transport_order()` and `closeTransportOrderOnAllRejected`; reject flow now auto-closes when all invitations are rejected. Spot reject must either reuse the same close wrapper or document deferral.
- Actual helper/RLS source of truth uses `vendor_users.auth_user_id = auth.uid()` and `is_active/deleted_at`; spec examples using `vendor_users.id = auth.uid()` are outdated.
- `transport_order_invitations` has no `deleted_at`, `updated_at`, or `bound_at`; skeleton must not reference them.
- Existing `respond_to_transport_order` and `accept_invitation_and_revoke_others` intentionally reject `vendor_id IS NULL` spot rows with `P0002`.
- Vendor request list/detail already query invitations under `withAuthenticatedDb`; once RLS/helper include spot ownership, UI queries can surface spot rows without service_role.
- Current pages display pending invitation rows only; spot first-touch token/onboarding is not implemented in the UI paths.
- `transport_orders.vendor_id` may be NULL for invitation races, but current `createTransportOrderWithNotification` still requires registered `vendorId`; spot creation is separate future work.

## 2. RPC  最終 SQL skeleton

```sql
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
  IF v_to_id IS NULL THEN RAISE EXCEPTION 'spot invitation not pending or not found' USING ERRCODE = 'P0002'; END IF;
  IF v_vendor_email IS DISTINCT FROM v_invitee_email THEN
    RAISE EXCEPTION 'spot invitation email mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_response = 'rejected' THEN
    UPDATE public.transport_order_invitations
      SET response='rejected', responded_at=now(), bound_vendor_id=v_vendor_id,
          bound_vendor_user_id=v_vendor_user_id
      WHERE id = p_invitation_id;
    SELECT version INTO v_version FROM public.transport_orders WHERE id = v_to_id;
    RETURN QUERY SELECT v_to_id, v_version, p_invitation_id, NULL::uuid, NULL::uuid, v_vendor_id, v_vendor_user_id;
    RETURN;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext(v_to_id::text)) THEN
    RAISE EXCEPTION 'transport_order % is being processed concurrently', v_to_id USING ERRCODE = '55P03';
  END IF;
  SELECT company_id, status_id INTO v_company_id, v_from_status_id FROM public.transport_orders WHERE id = v_to_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.transport_order_invitations WHERE transport_order_id=v_to_id AND is_winning_bid=true) THEN
    RAISE EXCEPTION 'transport_order already has winning bid' USING ERRCODE = '55P03';
  END IF;
  SELECT id INTO v_status_id FROM public.statuses
    WHERE company_id=v_company_id AND status_type='transport' AND key='accepted' AND is_active=true LIMIT 1;
  IF v_status_id IS NULL THEN RAISE EXCEPTION 'accepted status not seeded for company' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.transport_order_invitations SET response='accepted', is_winning_bid=true, responded_at=now(),
    bound_vendor_id=v_vendor_id, bound_vendor_user_id=v_vendor_user_id WHERE id=p_invitation_id;
  UPDATE public.transport_order_invitations SET response='revoked', responded_at=now()
    WHERE transport_order_id=v_to_id AND id<>p_invitation_id AND response='pending';
  UPDATE public.transport_orders SET vendor_id=v_vendor_id, status_id=v_status_id, version=version+1, updated_at=now()
    WHERE id=v_to_id RETURNING version INTO v_version;
  INSERT INTO public.transport_order_status_history(company_id, transport_order_id, from_status_id, to_status_id, changed_by_user_id, reason)
    VALUES (v_company_id, v_to_id, v_from_status_id, v_status_id, NULL, COALESCE(p_reason,'spot_vendor_accept')) RETURNING id INTO v_history_id;
  RETURN QUERY SELECT v_to_id, v_version, p_invitation_id, v_status_id, v_history_id, v_vendor_id, v_vendor_user_id;
END $$;
```

## 3. RLS 拡張案

```sql
-- 19_rls_policies.sql diff
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
          AND vu.is_active = true AND vu.deleted_at IS NULL
          AND lower(vu.email) = lower(transport_order_invitations.invitee_email)
      )
    )
  );

-- transport_orders policy can stay structurally identical if helper is extended:
-- OR id IN (SELECT public.vendor_invited_transport_order_ids(public.current_vendor_id()))
```

## 4. helper  拡張案

```sql
-- 18_helper_functions.sql diff inside vendor_invited_transport_order_ids(p_vendor_id)
  WHERE (vendor_id = p_vendor_id OR bound_vendor_id = p_vendor_id
    OR (
      vendor_id IS NULL AND invitee_email IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND EXISTS (
        SELECT 1 FROM public.vendor_users vu
        WHERE vu.id = public.current_vendor_user_id()
          AND vu.vendor_id = p_vendor_id
          AND lower(vu.email) = lower(transport_order_invitations.invitee_email)
      )
    ))
    AND response NOT IN ('revoked', 'expired')
```

## 5. service  シグネチャ + error mapping

```ts
export const RespondToSpotInvitationInput = z.object({
  invitationId: z.string().uuid(),
  response: z.enum(["accepted", "rejected"]),
  reason: z.string().max(500).optional(),
}).strict();

export async function respondToSpotInvitation(
  db: any,
  input: RespondToSpotInvitationInput,
): Promise<RespondToTransportOrderResult & {
  boundVendorId: string;
  boundVendorUserId: string;
}> {}
```

- Put in `src/lib/services/spot-invitations.ts`; import existing errors from `transport-orders.ts`; do not modify `respondToTransportOrder`.
- Error mapping reuse: `22023` -> `InvalidResponseValueError`; `P0002` -> `InvitationNotPendingError` or `StatusSeedMissingError` when message includes accepted status; `42501` -> `VendorAuthError`; `55P03` -> `ConcurrentTransportOrderResponseError`; `P0001` invalid transition -> `StatusTransitionError`.
- Reject path may call `closeTransportOrderOnAllRejected(db, transportOrderId)` after RPC, matching Phase 22, unless MVP deliberately defers auto-close for spot.

## 6. Auth / ownership 認可方式の確定

- Adopt: authenticated `vendor_user` + exact case-insensitive email match to `invitee_email`; token URL is first-touch/bootstrap only.
- Reason: portal/RLS invariants are built on Supabase Auth + `vendor_users`; token-only cannot participate in current RLS and would invite service_role bypass.
- Accept/reject authority: `current_vendor_user_id()` must resolve active row, `vendor_users.email` must match `invitee_email`, and accept binds `bound_vendor_id/bound_vendor_user_id`.
- Token URL first-touch design: validate token hash server-side, then route to login/signup; after auth, RPC still enforces email match.

## 7. Test 種別 (integration)

- happy accept: spot row `vendor_id NULL + invitee_email`, matching vendor_user accepts; invitation accepted/winning/bound, order vendor/status/version/history set.
- reject: matching vendor_user rejects; invitation rejected/bound user set, order vendor/status unchanged; close wrapper behavior asserted.
- ownership: different vendor_user or same vendor different email gets `VendorAuthError`.
- expired/not pending: expired, revoked, accepted, missing invitation all map to `InvitationNotPendingError`.
- concurrent accept: two spot invitations for same order accepting in parallel yields one winner and loser `55P03` or not-pending.
- mixed invitations: registered + spot pending rows; spot accept revokes registered pending rows and preserves registered RPC regression.
- RLS invitation visibility: matching email sees spot invitation; non-matching vendor_user sees 0; bound vendor remains visible after accept.
- DB constraints: `vendor_id NULL + invitee_email NULL` check violation; duplicate `(transport_order_id, invitee_email)` spot unique violation.

## 8. UI 影響範囲

- `/vendor/requests`: existing query can show spot rows after RLS/helper; add display for `invitee_name/email` only if UX needs "spot invitation" badge.
- `/vendor/requests/[id]`: existing detail works through invitation id; response form must call spot action/service when `vendor_id IS NULL`.
- Response action/router needs branch: registered invitation -> `respondToTransportOrder`; spot invitation -> `respondToSpotInvitation`.
- Token URL first-touch: new route such as `/vendor/invitations/[token]` verifies hash, shows login/signup handoff, never calls response RPC unauthenticated.
- Avoid service_role in portal pages; keep `withAuthenticatedDb` so RLS remains the visible boundary.

## 9. Migration 追加順序と既存 invariants 違反チェック

- Add after current 25: `26_spot_invitation_helper_rls.sql` then `27_spot_invitation_rpc.sql` (or one file if project prefers compact raw migrations).
- Helper/RLS must be before UI relying on spot list visibility; RPC can be after helper/RLS.
- Revoke `PUBLIC/anon` execute and grant `respond_to_spot_invitation(uuid,text,text)` only to `authenticated`.
- Do not alter `respond_to_transport_order(uuid,text,text)` signature, output, or service wrapper.
- Do not alter `accept_invitation_and_revoke_others(uuid)` registered-vendor semantics or its P0002 spot rejection.
- Preserve Phase 22 close invariant: all-rejected closure remains wrapper-level behavior, not a mutation inside registered RPC.
- Check no references to non-existent invitation columns (`deleted_at`, `updated_at`, `bound_at`).

## 10. 既知の懸念・前提条件・段階分割案

- MVP: response RPC + helper/RLS + service + integration tests + portal branch only.
- Extended: spot invitation creation service, email/token issuance, signup/onboarding, outbox payloads, revoked loser notifications.
- Email normalization should be explicit; lower-case comparison is enough for MVP, but generated normalized column/index may be needed later.
- Current helper signature cannot accept email; using `current_vendor_user_id()` inside helper preserves transport_orders policy shape but couples helper to auth context.

### Unresolved

- Whether spot reject should immediately call Phase 22 all-rejected close wrapper in Sprint β MVP.
- Token expiry and single-use semantics for `invitation_token_hash` are not implemented in existing UI/service.
- Whether accepted spot invitation should keep `vendor_id NULL` forever or backfill it; recommendation is keep NULL and rely on `bound_vendor_id`.
- Whether spot vendors must already have `vendors` + `vendor_users` before first accept, or first-touch signup creates them before RPC.
