# Phase 23 Recon: spot invitation onboarding pipeline

## 1. spec 該当箇所の引用と読解
- `spec/CLAUDE.md:74` は service_role を「Inngest worker / migration / 顧客 token 検証 / 監査クリーンアップ」に限定、`:129` は ADR-0010 として固定。RPC 内 auth.admin はこの境界外。
- `spec/CLAUDE.md:72,127` は `transport_order_invitations` による案件単位招待と ADR-0008 を採用、`:115` は業者ポータルを `vendor_users` 認証に限定。
- `spec/data-model.md:218-253` §3.6 は `vendor_users`、`:245` company 整合性例外、`:251` BEFORE INSERT/UPDATE trigger。`id=auth.users.id` 同期前提なので Auth user 作成後に vendor_users を作る。
- `spec/data-model.md:833-860` §7.10 は `transport_order_invitations`、`:848` `invitation_token_hash UNIQUE`、`:860` `vendor_id NOT NULL OR invitee_email NOT NULL`。
- `spec/data-model.md:943` は未登録業者を「招待 URL → Auth 招待 → vendor_users 登録 → bound_* → transport_orders.vendor_id」と読むが、実装責務はRPCではなく server-only first-touch route。
- `spec/requirements.md:520-522` §A は 3 パターン: 直接指名、複数同時打診、スポット業者 token URL。`:649,701,718` も service_role 限定/server 側利用を補強。

## 2. 4 ケース整理
- (a) 完全新規 vendor + 完全新規 auth_user: token first-touch route が token 検証後、`vendors` 作成、auth.users 作成、`vendor_users` INSERT。通常は session 確立後に spot RPC。失敗条件は token 無効/期限切れ、同一 email 既存、vendor 作成不可。
- (b) 既存 vendor + 新規 auth_user: route が既存 vendor を invitation 文脈から選択し、auth.users 作成、`vendor_users` INSERT。通常は同じく session 後 RPC。失敗条件は vendor inactive/deleted、会社不整合、email duplicate。
- (c) 既存 vendor_user (same email different vendor): NG。`vendor_users.email` UNIQUE 前提では同一 email を別 vendor に再作成できず、別 vendor 所属者が別案件 spot を受けるのは tenant/ownership が曖昧。明示的に 409/42501 相当で拒否し、admin に vendor 統合/移籍判断を返す。
- (d) 既存 vendor_user (same vendor existing): route はユーザー作成せず login/signup wall で既存認証へ誘導。通常は認証後 RPC。失敗条件は inactive/deleted、email mismatch、invitation not pending/expired。

## 3. 推奨 onboarding pipeline (step-by-step)
1. Admin creates spot `transport_order_invitations` with `vendor_id=NULL`, invitee fields, token hash, `expires_at`.
2. Vendor opens token URL; first-touch server route hashes token and reads pending invitation with service_role.
3. Route rejects expired/revoked/accepted tokens and never calls spot RPC while unauthenticated.
4. Route resolves onboarding case (a)-(d), normalizes email, and checks duplicate ownership.
5. For new vendor path, route creates `vendors` row before `vendor_users` because `vendor_users.vendor_id` is NOT NULL FK.
6. Route creates or invites Supabase Auth user using service_role, then inserts `vendor_users` with `id = auth.users.id` and matching `vendor_id`.
7. Route establishes/redirects to authenticated vendor session; existing user goes through login wall.
8. Authenticated vendor portal calls spot RPC; RPC assumes active `vendor_user`, verifies email/invitation, binds `bound_vendor_id/bound_vendor_user_id`, then accepts/rejects.

## 4. service_role 利用境界の正当化
- Explicitly reject: SECURITY DEFINER RPC calling `auth.admin.createUser` or any auth.admin API. DB functions run in Postgres, not Supabase Admin SDK, and this violates ADR-0010.
- First-touch route is server-only token verification for a non-authenticated external principal, closest to ADR-0010「顧客 token 検証」but vendor-facing.
- Recommendation: add explicit ADR-0010 extension:「vendor invitation token verification/onboarding server route」。Do not silently treat it as existing Inngest/migration/audit category.
- The route must audit at entry and before privileged mutations, mirroring service_role policy discipline.

## 5. vendors 行作成タイミング決定
- (a) at invitation creation by admin: reject for spot MVP. It creates placeholder vendors before the invitee proves possession of token/email and increases cleanup/orphan handling.
- (b) at first-touch signup: recommend. It satisfies `vendor_users.vendor_id NOT NULL FK`, keeps onboarding atomic, and avoids RPC service_role.
- (c) other path: existing admin-managed vendor can be reused for case (b)/(d), but fully new spot vendors should be created in first-touch route before `vendor_users`.
- Contradiction 2 resolution: vendors are not created by the RPC. They are created either earlier by admin for known vendors, or during first-touch signup before `vendor_users` INSERT.

## 6. token URL design
- Path: `/vendor/invitations/[token]` under `src/app/(vendor-portal)/vendor/invitations/[token]/page.tsx` plus server action/route handler.
- Store only `sha256(token)` in `transport_order_invitations.invitation_token_hash`; raw token appears only in URL/email.
- `expires_at` must be enforced in first-touch route and RPC. Expired token returns no onboarding mutation.
- Single-use revoke: after successful onboarding/session binding, clear token or set response/bound marker so token cannot bootstrap another account; loser invitations are revoked on accept.

## 7. spot RPC への impact (recon #1 SQL skeleton 変更点)
- RPC remains authenticated-only and assumes existing active `vendor_user`; keep `current_vendor_user_id() NULL → 42501`.
- Remove any idea that RPC creates auth.users/vendors/vendor_users. That belongs to first-touch server route.
- Signature does not need onboarding fields; keep `respond_to_spot_invitation(invitation_id,response,reason)`.
- RPC may require stricter case (c) guard: `lower(vendor_users.email)=lower(invitee_email)` and current vendor must equal/bind target vendor.

## 8. 既存 first-touch route の有無 + 新規必要なファイル
- Prior recon/source shape shows vendor portal request routes exist, but spot token first-touch route is not implemented; existing service is registered-vendor only.
- Existing references: `src/lib/services/transport-orders.ts` maps RPC errors; `src/lib/supabase/server.ts` server client; `src/lib/db/with-auth.ts` authenticated DB; `src/middleware.ts` vendor matcher; `scripts/seed-vendor-dev.ts` is dev auth.users+vendor_users reference only.
- New files likely needed: `src/app/(vendor-portal)/vendor/invitations/[token]/page.tsx`, `actions.ts` or route handler for onboarding, `src/lib/services/spot-onboarding.ts`, tests for cases (a)-(d).
- Migration/RPC files remain separate: helper/RLS/RPC from spot recon plus optional ADR note/migration for token single-use fields if current columns are insufficient.

## 9. 段階分割案 (MVP / Extension)
- MVP: token verify page, first-touch onboarding route, vendors/vendor_users creation, existing-user login handoff, authenticated spot RPC, integration tests for (a)-(d), expired/single-use.
- MVP also documents ADR-0010 extension and rejects RPC-side auth.admin usage.
- Extension: admin vendor management UI, resend/revoke, vendor merge/transfer workflow for case (c), richer invitation audit list, bulk spot invites.

## 10. 既知の懸念 + Unresolved
- Need exact implementation choice for Supabase Auth: `inviteUserByEmail` vs create user + magic link, depending on desired password setup UX.
- Same-email different-vendor case (c) is explicitly NG for MVP; future support needs a vendor account membership/merge design, not duplicate `vendor_users.email`.
- Decide whether token is cleared, rotated, or marked consumed after onboarding if response is still pending before accept.
- Confirm existing raw migration helper uses `auth_user_id` vs spec examples using `id=auth.uid()` before writing SQL, but onboarding contract remains: active vendor_user required before RPC.
