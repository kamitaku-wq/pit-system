# Phase 21 / 16-E Recon: spot invitation RPC

## 1. spec/data-model + requirements で定義されている spot invitation 仕様

- `spec/data-model.md` v2.4 は `transport_order_invitations.vendor_id` を nullable と定義し、`NULL = 未登録業者宛`、受諾後に `bound_vendor_id` / `bound_vendor_user_id` と `transport_orders.vendor_id` を埋める意図。
- target 制約は `vendor_id IS NOT NULL OR invitee_email IS NOT NULL`。spot は `vendor_id NULL + invitee_email NOT NULL` が DB 上の正規形。
- `transport_orders.vendor_id` も nullable。requirements は複数業者同時打診では `transport_orders.vendor_id = NULL` で作成し、先着受注者を後でセットすると定義。
- requirements v2.2 は 3 パターンを分離: 直接指名は `transport_orders.vendor_id` 直指定、複数同時打診は invitations 複数行、スポット業者は token URL 経由で案件単位招待。
- `is_winning_bid=true` は transport_order 単位 partial unique。受諾した 1 招待だけ winning、残り pending は revoked。
- `quoted_amount_minor` / `tax_rate_bps` / `billing_status` は `service_tickets` の経理連携先行カラムで、spot invitation の応答 RPC 直接入力ではない。現行 SQL/Drizzle は spec と差があり、NOT NULL default (`quoted_amount_minor=0`, `tax_rate_bps=1000`, `billing_status='unbilled'`)。
- `offered_amount_minor` は spec / schema / raw migration に見当たらない。spot bid 金額を 16-E で扱うなら、新規列追加ではなく別 phase 設計が必要。

## 2. 既存 respond_to_transport_order との差分 (input/output/edge case)

- 既存 RPC: `respond_to_transport_order(p_invitation_id uuid, p_response text, p_reason text default null)`。service は `respondToTransportOrder(db, { invitationId, response, reason? })` の薄い wrapper。
- 既存 RPC は registered vendor 前提。accept は `accept_invitation_and_revoke_others(p_invitation_id)` を呼び、そこで `vendor_id NULL` は `P0002 'invitation has no bound vendor (spot invitation flow)'` で明示的に拒否。
- 既存 output は `{ transportOrderId, invitationId, version, newStatusId|null, historyId|null }`。accept のみ accepted status 解決、`transport_orders.status_id` 更新、history append。reject は invitation のみ更新。
- spot accept では `invitation.vendor_id` ではなく caller の `current_vendor_user_id()` -> `vendor_users.vendor_id` を winner として bind する必要がある。
- spot reject は vendor 未 bind のため、現在の vendor mismatch 認可は使えない。token/email 所有確認か、auth user と invitee の紐付け済み vendor_user を前提にするかを RPC 境界で決める必要あり。
- 既存 helper は advisory lock (`pg_try_advisory_xact_lock(hashtext(transport_order_id::text))`) で競合制御し、`55P03` を concurrent として返す。spot も同じ lock と winning unique を使う。
- 既存実装に `SELECT FOR UPDATE` は見当たらない。spec の古い疑似 SQLには `FOR UPDATE` があるが、現行 source of truth は advisory lock。

## 3. invitations.vendor_id NULL 時の DB-level constraint / 列必須性

- `transport_order_invitations.vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL`、Drizzle も nullable。
- `invitee_email` は nullable だが `invitations_target_check` により `vendor_id NULL` の場合は必須。
- unique: `(transport_order_id, vendor_id) WHERE vendor_id IS NOT NULL`、`(transport_order_id, invitee_email) WHERE vendor_id IS NULL`。
- response check: `pending|accepted|rejected|revoked|expired`、default `pending`。
- `is_winning_bid boolean NOT NULL DEFAULT false`。`transport_order_invitations_winning_unique` が `transport_order_id` 単位の winner を 1 件に制限。
- `bound_vendor_id` / `bound_vendor_user_id` は nullable。spot accept 時に必ずセットし、registered invitation でも既存 helper がセット済み。
- RLS: invitations の vendor SELECT は `vendor_id = current_vendor_id()` のみ。`vendor_id NULL` spot invitation は現状 vendor portal から見えない。
- helper `vendor_invited_transport_order_ids(p_vendor_id)` も `vendor_id = p_vendor_id` のみで、spot invitation は transport_order SELECT 対象外。

## 4. 推奨 service/RPC シグネチャ案 (型ヒント込み、対応 error code)

- RPC は別名推奨: `respond_to_spot_invitation(p_invitation_id uuid, p_response text, p_reason text default null) RETURNS TABLE(transport_order_id uuid, version int, invitation_id uuid, new_status_id uuid, history_id uuid, bound_vendor_id uuid, bound_vendor_user_id uuid)`。
- service は新ファイル or 同ファイル追加で `respondToSpotInvitation(db, input)`。input: `{ invitationId: string; response: 'accepted'|'rejected'; reason?: string }`。
- auth は既存方針を継承し、`current_vendor_user_id()` を唯一の caller source にする。`actingVendorUserId` は入れない。
- accept path: pending invitation を取得、`vendor_id IS NULL` を必須検証、caller vendor_user/vendor_id を取得、advisory lock、winning 既存チェック、invitation accepted + `bound_vendor_*`、他 pending revoked、`transport_orders.vendor_id = caller_vendor_id` + version bump、accepted status + history append。
- reject path: token/email 所有確認が未設計。16-E 最小実装では authenticated vendor_user が `invitee_email` と一致する等の明示条件が必要。条件なし reject は他人の spot invitation を拒否できるため不可。
- error mapping は既存と合わせる: `22023` invalid response, `P0002` not pending/not spot/status missing, `42501` auth/ownership, `55P03` concurrent, `P0001` status transition。
- TypeScript error class は既存 6 種を再利用しつつ、必要なら `SpotInvitationOwnershipError` は `VendorAuthError` 系に畳む方が 66 tests への影響が小さい。

## 5. 既存 transport-orders.ts への impact (touch 必要か / 新ファイル分離か)

- Phase 19/20 invariant により `RespondToTransportOrderInput` / `Result` / error class 名 / `respondToTransportOrder` / RPC signature は触らない。
- spot service は `src/lib/services/spot-invitations.ts` などに分離推奨。既存 `transport-orders.ts` は registered vendor 1 件作成 + response wrapper で肥大化済み。
- ただし error class を共有したい場合だけ `transport-orders.ts` から export 維持し、新 service が import する形が低リスク。
- `createTransportOrderWithNotification` は `vendorId` 必須 Zod かつ membership 必須なので spot invitation 作成には使えない。別 service (`createSpotTransportOrderInvitation` or `addSpotInvitationToTransportOrder`) が必要。
- vendor portal の一覧/RLSは spot invitation を拾えないため、UI 対象に含めるなら RLS/helper 側も拡張が必要。RPC だけでは一覧表示できない。

## 6. 必要な test 種別 (happy / multi-vendor concurrent / vendor_id NULL → assigned 遷移 / RLS)

- integration happy: `vendor_id NULL + invitee_email` の pending invitation を authenticated vendor_user が accept し、invitation accepted/winning、`bound_vendor_id`、`bound_vendor_user_id`、`transport_orders.vendor_id`、accepted status/history を確認。
- reject: spot invitation reject が `transport_orders.status_id/vendor_id` を変えず、invitation のみ rejected になること。所有確認 failure も必須。
- multi-vendor concurrent: 同一 transport_order の spot invitation 複数件を並行 accept し、1 件だけ winning、他は revoked、loser は `55P03` or not-pending 相当。
- mixed invitations: registered vendor invitation と spot invitation が混在しても winner unique と revoke が同じ挙動。
- DB constraint: `vendor_id NULL + invitee_email NULL` は check violation、同一 order/email spot 重複は unique violation。
- RLS: `vendor_id NULL` invitation が現行 `vendor_select` で見えないことをまず固定し、拡張後は invitee/caller 以外に漏れないことを確認。
- regression: 既存 `respondToTransportOrder` 17 integration cases、Phase 20 合計 66 tests、`respond_to_transport_order(uuid,text,text)` smoke を維持。

## 7. 警告・既存壊してはいけないもの

- `respond_to_transport_order` を spot 対応に拡張しない。既存 P0002 spot failure は Phase 19 の明示仕様で、registered vendor path の安定性に効いている。
- `accept_invitation_and_revoke_others(uuid)` も直接改変しない方が安全。spot 用 helper/RPC で同等処理を分ける。
- `transport_order_invitations.vendor_id NULL` は RLS 上 invisible。RPC は SECURITY DEFINER でも `auth.uid()` / `current_vendor_user_id()` / ownership check を必ず内部で行う。
- audit_logs は trigger 委譲。RPC/service 内で手動 audit insert しない。
- all-rejected order closure (`closeTransportOrderOnAllRejected`) は別 TODO。spot RPC に混ぜると Phase 19 の reject 不変性を壊す。
- `offered_amount_minor` は未定義。16-E で金額入札まで入れると migration/schema/API 追加になり scope over。
- `supabase/migrations` は存在せず、現行調査対象 SQL は `src/lib/db/raw-migrations/alpha-1-public/*.sql`。
