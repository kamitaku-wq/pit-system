# Phase 64-C.4 業者対応不可フォールバック — 設計 / 分解計画 (plan)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C.4 (業者対応不可フォールバック / L3-3 次候補打診・L3-4 希望日時変更再依頼・L3-5 手動切替, α 必須) |
| 種別 | **plan** (実装は次 fresh セッション)。本書が唯一文脈源 |
| 前提 | C.0-C.3 + follow-up #1 (post/0031) + follow-up #2 (post/0032) sealed + commit 済。Lane C の最後の機能 |
| Branch | `phase-64-mvp-implementation` 継続 |
| 調査 | canonical = cancelTransportOrder パターンB 精読 + createTransportOrderWithNotification + 状態 seed (post/0012-0028) + architect 第二意見 (案A 確定) |
| adversarial gate | **該当 (raw-migration)**: 状態モデル補正 (post/0033) で rejected を is_terminal=false 化 + rejected→requested 遷移 seed。seal 前に Codex adversarial + advisor 2 回目を「状態機械整合 / cross-tenant / 二重通知 / close 再発火」フレームで必須 |
| 決定ログ | **D-C4-1 = 案A** (同一 order 再オープン) [2026-05-30 ユーザー確定, architect 推奨]。**D-C4-2 = L3-3/L3-5 統合コア** (Claude 推奨, 下記)。**D-C4-3 / D-C4-4 = 実装時に確定** (下記 open) |

## 要件根拠

- requirements.md §16「業者対応不可時のフォールバック」: 対応不可 → 店舗が ①次候補業者を選んで再打診 (attempt_seq++ で新 outbox・idempotency_key 新規) ②希望日時変更して同業者へ再依頼 ③キャンセル (既存 cancelTransportOrder)。
- requirements.md §17 line 633:「業者対応不可」からは「キャンセル」「**再打診（実質新依頼）**」「希望日時変更」のみ許容。
- canonical: `cancelTransportOrder` パターンB (service_role db, raw SQL tx 内で UPDATE→status_history→change_logs(requires_notification=false)→invitation revoke→outbox INSERT, idempotency_key 構造化, ADR-0007 楽観排他 IF MATCH version)。

## D-C4-1 確定 = 案A (同一 order 再オープン) — 状態モデル補正

**architect reframe (確定根拠)**: 'rejected' は真の terminal ではない。`rejected→cancelled` 遷移が既に seed 済 = `is_terminal=true` は遷移グラフと矛盾する**誤分類**。真の終端は `completed` / `cancelled` のみ。'rejected' は「業者が断った→店舗が判断する」stall 状態。`transport_order_vendor_attempts.attempt_seq` / `transport_order_invitations` / `change_type='rejected_reassigned'` は全て**同一 order 上の複数試行**を前提に設計されている (spec-native)。案B (新 order 再作成) は superseded_by 列追加 + 全参照箇所の「現在 order」判定 + attempt_seq vestigial 化を招き不利。

### 現状の状態モデル (post/0012-0028 seed)

- statuses: `requested`(initial) / `accepted` / `completed`(terminal) / `rejected`(**現 terminal**) / `cancelled`(terminal)
- 遷移 6: requested→accepted, requested→rejected, accepted→completed, accepted→cancelled, requested→cancelled, rejected→cancelled
- MVP は単一 vendor invitation。対応不可 (reject) → reject 経路が `closeTransportOrderOnAllRejected` を呼び、全 invitation rejected を検知 → **order が 'rejected' に遷移** (terminal)。
- `enforce_status_transition` (BEFORE UPDATE OF status_id) が seed 済み遷移のみ許可。

### C.4.0 = 状態モデル補正 migration `post/0033_reopen_rejected_transport_status.sql` (raw-migration, gate 対象)

1. `seed_transport_statuses_for_company()` を CREATE OR REPLACE: `rejected` の `is_terminal` を **false** に変更 (terminal = {completed, cancelled} のみ) + 遷移に **`rejected → requested`** を追加 (既存 6 遷移は維持)。`requested→requested` 自己遷移は seed しない (在 'requested' での date 変更は status を変えないため不要)。
2. **backfill 既存 company**: `UPDATE statuses SET is_terminal=false WHERE status_type='transport' AND key='rejected'` + 新遷移を全 company に ON CONFLICT DO NOTHING で INSERT (post/0028 の backfill 作法踏襲)。
3. `rejected→requested` の `triggers_notification` = **false** (C.4 service が outbox を明示 enqueue)。
4. spec/data-model.md §17.1 + §15.5 に「rejected は stall (非 terminal)、再打診で requested へ再オープン」を A.25 drift 作法で注記。

### is_terminal=false 化の波及 (grep 済, blast radius)

| 箇所 | 影響 |
|---|---|
| `transport-orders.ts:511,530` cancelTransportOrder terminal ガード | **是正**: 現状 is_terminal=true で rejected の cancel を阻むが、rejected→cancelled は seed 済で矛盾。false 化で rejected order が cancel 可能になり整合 |
| `transport-orders.ts:314` / `spot-invitations.ts:98` respond terminal ガード | rejected order は再オープン後 'requested' になり respond 可。'rejected' 中は pending invitation 不在で respond は「not pending」で弾かれる → 安全 |
| `admin/statuses/*` UI | is_terminal 表示 (◯) が cosmetic に変わるのみ |
| ダッシュボード active 一覧フィルタ | rejected が非 terminal 扱いになるので「対応中/再打診待ち」に出現させる意図と整合 (要確認, 下記 architect #6) |

## 分解 (C.4.0 → C.4.3)

| サブ | 内容 | 判断量 | Codex 委任 | gate |
|---|---|---|---|---|
| **C.4.0** | 状態モデル補正 (post/0033: rejected is_terminal=false + rejected→requested seed + backfill + spec 注記) | 高 (状態機械 + raw-migration) | NO | **該当** |
| **C.4.1** | 再割当コア `reassignTransportOrderVendor` (L3-3 fallback + L3-5 manual を mode で統合) + 共有 helper `reopenOrderForResolicit` | 中〜高 | 部分 | C.4.0 後 |
| **C.4.2** | `rescheduleAndRenotifyTransportOrder` (L3-4 希望日時変更再依頼, 同 vendor) | 中 | 部分 | — |
| **C.4.3** | admin actions (nextVendorAction / switchVendorAction / rescheduleAction) + UI (対応不可 order の操作パネル) + tests | 中 | UI 部分委任 | — |

## C.4.1 設計: 再割当コア (L3-3 次候補打診 + L3-5 手動切替 統合)

**D-C4-2 = 統合コア** (Claude 推奨): L3-3 と L3-5 は「別 vendor へ再割当」という同一操作で、差分は (change_type / selection_method / selection_reason) タグのみ。1 サービス + mode param に統合し、2 つの薄い admin action で呼び分ける (DRY)。

### `reassignTransportOrderVendor(db, companyId, userId, input)`

- Input (Zod strict): `{ transportOrderId, expectedVersion, newVendorId, mode: 'fallback'|'manual', selectionReasonNote?, consideredVendorIds?: uuid[], reason? }`
- mode 別タグ:
  - `fallback` (L3-3 次候補打診): change_type=`rejected_reassigned`, selection_method=`fallback`, selection_reason=`vendor_unavailable`
  - `manual` (L3-5 手動切替): change_type=`vendor_changed`, selection_method=`manual`, selection_reason=`manual_preference`
- tx (パターンB):
  1. order load (version, vendor_id, status_id, status_key, deleted_at) + IF MATCH version。完了/キャンセル (真 terminal) は不可 (TerminalStatusError)。
  2. `newVendorId` の active `vendor_company_memberships` 検証 (createTransportOrderWithNotification と同, VendorMembershipError)。
  3. 共有 helper `reopenOrderForResolicit(tx, ...)` を呼ぶ (下記)。target vendor = newVendorId。
  4. `vendor_selection_logs` INSERT (selected_vendor_id=newVendorId, selected_by_user_id=userId, selection_method, selection_reason, selection_reason_note, considered_vendor_ids)。
  5. `transport_order_change_logs` INSERT (change_type per mode, before/after snapshot {vendor_id, status_key, version}, requires_notification=false)。
  6. outbox INSERT: event_type=`transport_order.invitation.sent`, target_type='vendor', target_id=newVendorId, idempotency_key=`to:{orderId}:invite:{newInvitationId}` (invitation id は行毎一意ゆえ attempt 間で自然に衝突しない → architect #5 充足), payload。
- Returns `{ transportOrderId, newVersion, newVendorId, newInvitationId, attemptSeq, notificationOutboxId, idempotencyKey }`。

### 共有 helper `reopenOrderForResolicit(tx, { companyId, userId, orderRow, targetVendorId })`

architect の必須対応 (#3,#4,#7) を集約:
1. 現 pending/accepted invitation を `revoked` に (cancel と同)。
2. `attempt_seq = COALESCE(MAX(attempt_seq for order), 0) + 1`。`transport_order_vendor_attempts` INSERT (vendor_id=targetVendorId, attempt_seq, requested_at=now(), response='pending')。**注**: 現状 attempts テーブルは空 (初期 invitation は attempt 記録しない)。C.4 が初の writer。初期 invitation を attempt 0/1 として backfill はしない (out of scope, 将来)。
3. 新 `transport_order_invitations` INSERT (vendor_id=targetVendorId, invited_by_user_id=userId, response='pending')。
4. transport_orders UPDATE: vendor_id=targetVendorId, **status を requested へ再オープン** (status_key='rejected' のときのみ rejected→requested。既に 'requested' なら status_id 据置で自己遷移 trigger を避ける), **scalar リセット**: vendor_response=NULL, vendor_response_at=NULL, scheduled_pickup_at/delivery_at/return_at=NULL, store_confirmed_at=NULL, store_confirmed_by_user_id=NULL, version=version+1, updated_at=now()。**リセットしないと close_transport_order の「全 invitation rejected」検知が再発火する** (architect #3)。
5. status 変更時のみ `transport_order_status_history` INSERT (from=old, to=requested, changed_by_user_id=userId, reason)。
6. 返す: { newInvitationId, attemptSeq, newVersion, fromStatusId, reopened: boolean }。

## C.4.2 設計: 希望日時変更再依頼 (L3-4)

### `rescheduleAndRenotifyTransportOrder(db, companyId, userId, input)`

- Input: `{ transportOrderId, expectedVersion, requestedPickupAt?, requestedDeliveryAt?, requestedReturnAt?, reason? }` (希望日時 = `transport_orders.requested_*_at` = 店舗希望、vendor 入力の scheduled_* とは別軸)。
- tx:
  1. order load + IF MATCH version。完了/キャンセル不可。target vendor = **現 order.vendor_id (同 vendor)**。
  2. requested_*_at を更新 (指定列のみ COALESCE)。
  3. **D-C4-4 (open, 実装時確定)**: order が 'rejected' (同 vendor が対応不可済) の場合は `reopenOrderForResolicit` で同 vendor へ再オープン (新 invitation + attempt_seq++ + status→requested + scalar リセット)。order が 'requested' (vendor 未応答) の場合は status 据置で既存 invitation のまま日時更新 + 再通知のみ。MVP では「対応不可後の同 vendor 再依頼」が主用途。両対応 or rejected-only に絞るかを実装時に確定。
  4. `transport_order_change_logs` INSERT (change_type=`datetime_changed`, before/after = requested_* 値, requires_notification=false)。
  5. outbox INSERT: event_type=`transport_order.changed`, target=同 vendor, idempotency_key=`to:{orderId}:changed:{changeLogId}` (change_log id は行毎一意), payload。

## idempotency_key (§15.6 準拠)

- 再打診/手動切替 (新 invitation): `to:{orderId}:invite:{newInvitationId}` (既存 :invite: 再利用、invitation id で attempt 間衝突なし)
- 希望日時変更: `to:{orderId}:changed:{changeLogId}` (既存 :changed: 再利用)
- いずれも行 id ベースゆえ attempt_seq を key に含めずとも一意 (architect #5 の dedup-suppress 懸念は解消)。

## close_transport_order の再発火対策 (architect #4)

`reopenOrderForResolicit` の scalar リセット (vendor_response=NULL) + 旧 invitation revoke により、再オープン後に attempt-1 の rejected invitation が再び close を誘発しない。**ただし** `close_transport_order` は「全 invitation の response 集計」で判定するため、revoked invitation を集計から除外する必要がある (現実装は accepted/pending/rejected のみ COUNT、revoked は除外済か要確認)。要確認事項: `close_transport_order` が revoked を rejected と誤集計しないこと。誤集計するなら post/0033 で close 関数も「現 attempt_seq の invitation のみ集計」or「revoked 除外」に補正 (architect #4)。**C.4.0 着手時に close_transport_order を精読し判定**。

## admin action / 経路 (C.4.3)

- C.2 と同じ ADR-0010 service_role `db` (client.ts) 経路。`import { db } from "@/lib/db/client"` → `reassignTransportOrderVendor(db, adminUser.companyId, adminUser.userId, {...})`。
- 3 action: `nextVendorAction` (mode='fallback') / `switchVendorAction` (mode='manual') / `rescheduleAction` (L3-4)。`src/app/admin/transport-orders/[id]/actions.ts` に追加 (cancel/confirm と併置)。
- UI: 対応不可 (rejected) order の詳細ページに操作パネル (次候補 vendor 選択 select + 手動切替 vendor 選択 + 希望日時変更フォーム)。vendor 候補は active membership から列挙。UI ボイラープレートは Codex 委任候補 (sandbox 制約時は §2.5 fallback で Claude 直実装)。

## tests (CI gate, A.34 precedent)

integration (withRollback + 必要なら SET LOCAL ROLE):
- C.4.0: rejected→requested 遷移が enforce_status_transition を通過 / rejected が is_terminal=false / backfill 冪等。
- C.4.1: fallback 再割当 (order rejected→requested, 新 invitation+attempt_seq=1, vendor_selection_log method=fallback, 旧 invitation revoked, outbox invite) / manual 切替 (method=manual, change_type=vendor_changed) / version mismatch→Concurrent / 完了 order→Terminal / 非 active vendor→Membership / attempt_seq インクリメント (2 回連続)。
- C.4.2: reschedule (requested_* 更新 + change_log datetime_changed + outbox changed) / rejected 同 vendor 再オープン。
- 再発火回帰: 再オープン後に close が即再発火しないこと (scalar リセット検証)。

## adversarial gate (raw-migration, 発火条件 #1)

post/0033 = 状態機械変更ゆえ seal 前必須。フレーム: ①状態機械整合 (rejected→requested 追加で不正遷移経路が増えないか, is_terminal=false の波及全箇所) ②close 再発火 (revoked 集計) ③cross-tenant (company scope) ④二重通知 (idempotency) ⑤attempt_seq 競合 (unique 制約 + 並行)。Codex 異モデル + advisor 2 回目。

## invariants (壊さない)

- `24_vendor_rpcs.sql` / `27_spot_rpc.sql` touch 不可。再割当は service 層 (TS) + post/0033 seed のみ。
- UPDATE は IF MATCH version + version+1 (ADR-0007)。
- 通知は notification_outbox 経由・payload.channel 明示 (dispatcher は email のみ)。
- 新 status/遷移は seed 関数 (post/0015 系) + backfill で per-company 整合。
- follow-up #1 (post/0031 status_id grant 除去) / follow-up #2 (post/0032 helper guard) / A.21-A.34 / C.0-C.3 invariants 全件維持。
- spot accept (respond_to_spot_invitation) は無影響。

## open sub-decisions (実装時確定)

- **D-C4-3**: 再割当時に旧 (rejected) invitation の attempt 記録を遡及 backfill するか (現状しない方針 = 新 attempt のみ記録)。
- **D-C4-4**: L3-4 を「rejected 後の同 vendor 再依頼」限定にするか、'requested' 中の日時変更+再通知も両対応するか。
- **D-C4-5**: close_transport_order が revoked invitation を誤集計しないか (C.4.0 着手時に精読 → 必要なら post/0033 で補正)。

## 次セッション (C.4 実装) の最初の手順

1. 本 plan + C plan + follow-up #1/#2 handoff を読む (唯一文脈源)。
2. **close_transport_order (25_close_transport_order.sql) を精読** し D-C4-5 を確定 (revoked 集計)。
3. **C.4.0** `post/0033` 実装 (rejected is_terminal=false + rejected→requested seed + backfill + spec 注記) → integration test → **adversarial gate** 通過 → checkpoint。
4. **C.4.1** reassignTransportOrderVendor + reopenOrderForResolicit helper → test。
5. **C.4.2** rescheduleAndRenotifyTransportOrder → test。
6. **C.4.3** admin actions + UI → test。
7. CI green 確認 → seal。これで Lane C 完了。

*Phase 64-C.4 plan / Generated by Claude 2026-05-30 / D-C4-1=案A (architect 推奨, ユーザー確定) / 状態モデル補正 (rejected stall 化) + 再割当統合コア + reschedule / 次セッション: C.4.0 から実装*
