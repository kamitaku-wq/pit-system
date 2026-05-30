# Phase 64-B 店間整備予約作成 — 着手計画メモ (薄い縦切り)

## 状態 (2026-05-30)
- branch `phase-64b-inter-store-reservation` (main = 7a52c35 から分岐)。
- スコープ = **薄い縦切り** (ユーザー確定): 店舗が陸送依頼を UI から作れる導線を最小で繋ぐ。

## 背景 (なぜ B が必要か)
- Phase 64-C (業者ループ後半: 対応可否/完了/確定/フォールバック) は完成済だが、**入口の「店舗が依頼を作る」が欠落**。
- `createTransportOrderWithNotification` service は存在 (transport_orders + status_history + invitation + outbox の4テーブル atomic) だが **caller が test のみ** = 本番で誰も呼べない。
- requirements §14.3: 予約確定時 1TX で reservations + service_tickets + transport_orders + attempts + outbox + history + audit。薄い縦切りでは既存 service_ticket/vehicle を選ぶ形にし、フル7テーブル新規生成はしない。

## 実装内容 (薄い縦切り)

### B-1: service に attempts INSERT 追加
`createTransportOrderWithNotification` (transport-orders.ts:65) に
`transport_order_vendor_attempts` INSERT (attempt_seq=1, requested_at=now(), response='pending') を追加。
- schema: companyId / transportOrderId / vendorId / attemptSeq(int notNull) / requestedAt(notNull) / response(text nullable)。
- 位置: invitation INSERT 後、outbox INSERT 前後どちらでも可 (FK は transport_order のみ)。
- spec §14.3 の「attempt_seq=1」を満たす。後の C.4 fallback は MAX+1 で連番継続 (既存 reopenOrderForResolicit と整合)。
- result に attemptSeq か attemptId を足すか検討 (既存 result type 拡張は最小に)。

### B-2: 陸送依頼作成 UI (transport-orders/new)
`src/app/admin/transport-orders/new/{page.tsx, actions.ts}` 新規。
- page (server component): 選択肢取得 — listServiceTickets / listVehicles / listVendors(active membership) / listStores。
- フォーム入力: serviceTicketId, vehicleId, vendorId, movementType(select: one_way/round_trip/pickup_only/three_point),
  pickupStoreId, deliveryStoreId, returnStoreId, requestedPickupAt/DeliveryAt/ReturnAt(任意), canDrive, notes。
- orderNumber は service 側 or action で自動採番 (例: TO-{uuid} or 連番)。現状 service は orderNumber 必須 → action で生成。
- action: getAdminUser → createTransportOrderWithNotification(db, {...}) → redirect(`/admin/transport-orders/${id}`)。
- 既存 service-tickets/new, cancel/confirm action のパターン踏襲。db = service_role。

### B-3: 移動パターン検証
movement_pattern_check (12_transport.sql) が DB で強制:
- one_way: pickup + delivery 必須, return NULL
- round_trip: pickup + delivery + return 必須
- pickup_only: pickup のみ, delivery/return NULL
- three_point: pickup + delivery + return 必須 + 相互に異なる
action/service の Zod で事前検証 (DB CHECK 違反を 23514 でなくフレンドリーエラーに)。または DB に委ねて 23514 を catch。
→ 薄い縦切りでは **DB CHECK に委ね、違反時のエラーを map** が最小。Zod superRefine で事前検証する方が UX 良いが任意。

### B-4: test
- integration: createTransportOrderWithNotification が attempts を attempt_seq=1 で INSERT すること (既存 test に追加 or 新規)。
- action 経路の薄い test は任意 (service 層で主検証)。

## スコープ外 (別サブタスク)
- reservations への atomic 連動 (フル §14.3)。薄い縦切りでは既存予約の任意紐付け or 紐付けなし。
- 業者選択 UI フィルタ (エリア/店舗/曜日) = L2-8 (Phase 64-E)。
- can_drive=false → tow_required 自動 = L2-7 (任意、action で set 可)。
- 移動パターン別の UI 動的フォーム (store フィールドの出し分け) は最小実装 (全部出して検証) で可。

## 既存パターン参照
- atomic TX + exclusion: `customer-reservation-create.ts` (reservations + customers + vehicles + history + audit)。
- admin action: `transport-orders/[id]/actions.ts` (cancel/confirm/nextVendor/...)。
- new フォーム: `service-tickets/new/`, `vehicles/new/`。
- attempts 連番: `transport-orders.ts:reopenOrderForResolicit` (MAX+1)。

## 検証ゲート
- tsc + next build + integration green を **目視確認してから単独 commit** (今セッションで赤 commit を4回出した反省)。
- 4+テーブル atomic は Phase 63 §12-4 で advisor/Codex ゲート指定だが、薄い縦切りは既存 4テーブル service を再利用 (新規 atomic 設計なし) + attempts 1行追加なので、advisor は B-1 完了後の設計確認で足りる。reservations フル連動をやる場合は必須。
