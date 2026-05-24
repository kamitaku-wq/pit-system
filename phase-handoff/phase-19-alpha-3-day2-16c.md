# Phase 19: Sprint α-3 Day 2 / 16-C respondToTransportOrder Handoff (sealed)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 19 |
| 状態 | sealed |
| 開始日時 | 2026-05-24T19:00+09:00 |
| 完了日時 | 2026-05-24T22:30+09:00 |
| 担当アクター | Claude (planning, integration, review) / Codex (DDL + helper Drizzle 化 + service + unit + integration 全 6 件委任) |
| 関連 branch | main (uncommitted、本 phase 後にまとめて commit) |
| 前 Phase | phase-18-alpha-3-day1-16b.md (sealed, commit 977a039) |
| 関連 incident | R-H-002 (Codex Windows sandbox は Write/Edit 全件通過、shell 実行のみ failed) |

## このフェーズで達成したこと

- registered vendor の **accept/reject 応答** を単一 SECURITY DEFINER RPC で atomic 化
- DDL `24_vendor_rpcs.sql` 新規: `respond_to_transport_order(p_invitation_id, p_response, p_reason)` 追加
- service 関数 `respondToTransportOrder(db, input)` を transport-orders.ts に追加 (RPC 薄 wrapper)
- 既存 `accept_invitation_and_revoke_others` を改変せず再利用、accept パスで先着 revoke + invitation winning + version bump を継承
- accept パスで `accepted` status_id 解決 → status_id UPDATE → status_history append (changed_by_user_id=NULL) を RPC 内で完結
- reject パスは invitation のみ更新、transport_order 不変 (全 pending 消滅時の order 終端は 16-E に scope outside)
- audit_logs は trigger 委譲、service/RPC 内手動 INSERT なし
- fixture helper `seedTransportStatuses` を Drizzle transaction 対応に書き換え、Phase 18 既存 integration test の inline seed も helper 呼出に統一 (assert 不変、DRY 達成)
- Codex adversarial review (del-20260524-125544-f9af) で P0 2 件 + P1 7 件 + P2 4 件指摘 → Plan v2 で全反映
- `pnpm test` 63/63 PASS (Phase 18 49 → Phase 19 63、+14)
- `pnpm typecheck` PASS

## Claude 側の主要設計判断 (Plan v2 確定後)

1. **単一 RPC 集中** (Plan v1 hybrid → v2 集中に Codex 指摘で変更): auth 検証 / accept 時 helper 呼出 + status update + history append / reject 時 invitation update を全て RPC 内で完結。service 層は Zod validate + RPC call + error mapping のみ
2. **error コード mapping**: P0001 (status transition、trg) → StatusTransitionError / P0002 (not pending / status not seeded) → InvitationNotPendingError or StatusSeedMissingError (message 分岐) / 22023 (invalid response) → InvalidResponseValueError / 42501 (auth) → VendorAuthError / 55P03 (concurrent) → ConcurrentTransportOrderResponseError
3. **全 reject 時の order 終端は 16-E に scope outside**: spec §7.10 未記載、Phase 19 で含めると scope 膨張、後続 phase で `closeTransportOrderOnAllRejected` service として実装予定
4. **fixture helper Drizzle 化**: Phase 18 既存 inline seed も helper 呼出に統一する refactor を含めることで DRY 達成 (Codex review P1-4 指摘解消)
5. **input shape 厳格化**: `actingVendorUserId` は完全削除、`current_vendor_user_id()` に集中 (spoof 防止)
6. **auth context test fixture**: `set_config('request.jwt.claims', {sub: authUserId}, true)` を tx 内で実行して `auth.uid()` を擬似設定する pattern を確立 (Codex review P0-2 指摘解消)
7. **Codex 委任率 100%**: 全 6 件 (DDL + helper + service + unit + integration + Phase 18 refactor) を Codex 直作成。Claude は計画立案 + adversarial review 反映 + 統合判断 + テスト実行に専念

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-125544-f9af | Phase 19 計画 adversarial review | P0 2 / P1 7 / P2 4 指摘 → Plan v2 反映 | applied |
| del-20260524-130741-44d3 | DDL 24_vendor_rpcs.sql 新規 (~150 行) | 単一 RPC 集中設計 | applied (誤 reject 後再採用相当、実体は本 phase に組込み) |
| del-20260524-130804-6ebd | seedTransportStatuses Drizzle 化 (~95 行) | helper 書き換え | applied (誤 reject 後再採用相当、実体は本 phase に組込み) |
| del-20260524-131904-6303 | service 関数 respondToTransportOrder 追加 (+113 行) | error class 5 件 + service 1 件 | applied |
| (unit test Task) | unit test +6 ケース | Zod input validation | applied |
| (integration test Task) | integration test +8 ケース + Phase 18 refactor 6 件 | 14 ケース全 PASS | applied |

委任率: 100% (6 ファイル/タスク全 Codex 直作成)。Claude は計画立案 + Codex 出力統合判断 + test 実行に専念。

## 主要ファイル (next phase reference)

- `src/lib/db/raw-migrations/alpha-1-public/24_vendor_rpcs.sql` — RPC 本体 (151 行)
- `src/lib/services/transport-orders.ts` — service 関数 (Phase 18 + 19 で 302 行)
- `tests/_helpers/seed-transport-statuses.ts` — Drizzle 化 helper (96 行)
- `tests/unit/services/transport-orders.test.ts` — unit test (13 ケース)
- `tests/integration/services/transport-orders.integration.test.ts` — integration test (14 ケース)
- `phase-handoff/phase-19-alpha-3-day2-16c-plan.md` — Plan v2 (Codex review 反映済)
- `spec/data-model.md` §7.10 (line 833-942) / §15.6 (line 1576-1585)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` line 153-249 — 既存 `accept_invitation_and_revoke_others` (改変なし、本 phase で再利用)

## データモデル変更

DDL 追加のみ (RPC 1 件)、table 列変更なし。Drizzle schema 再生成不要。

## API 契約 (respondToTransportOrder)

**Input** (Zod strict):
- `invitationId`: uuid (required)
- `response`: 'accepted' | 'rejected' (required)
- `reason`: string max 500 (optional)

**Output**: `{ transportOrderId, invitationId, version, newStatusId | null, historyId | null }`

**Errors (export)**:
- `InvitationNotPendingError` (P0002 message 'not pending')
- `VendorAuthError` (42501)
- `StatusTransitionError` (P0001)
- `ConcurrentTransportOrderResponseError` (55P03)
- `InvalidResponseValueError` (22023)
- `StatusSeedMissingError` (P0002 message 'accepted status not seeded', Phase 18 既存 export 再利用)

## テスト・QA 状況

- `pnpm test` **63/63 PASS** (Phase 18 49 + Phase 19 +14 新規)
  - integration test 14 件全 PASS (Phase 18 6 件 refactor 後維持 + Phase 19 新規 8 件)
  - unit test 13 件全 PASS (Phase 18 7 件 + Phase 19 新規 6 件)
- `pnpm typecheck` PASS
- migration full apply は本 phase スコープ外 (staging smoke は 16-D 以降)
- 未検証: production 実 vendor user の RLS 経路 + 16-D portal UI 経路

## 既知の懸念・TODO

- [ ] **全 invitation reject 時の transport_order 終端処理** — `closeTransportOrderOnAllRejected` service を 16-E で追加 (spec §7.10 未記載のため Phase 19 で scope outside と決定)
- [ ] **UI 二重 submit 対策** — Phase 19 では P0002 raise のまま、UI 層 409 表示 / idempotent retry は 16-D portal で実装
- [ ] **spot invitation flow (vendor_id NULL)** — Phase 19 では P0002 raise、16-E で `respond_to_spot_invitation` 別 RPC を追加
- [ ] **transport_orders.vendor_response 系列の KPI 列更新** — β 繰越 (spec §14.7)
- [ ] **Codex Windows sandbox R-H-002 残課題** — Write/Edit 全件通過、shell 実行のみ failed (typecheck/test は Claude 側で pnpm 直接実行で通る運用継続)
- [ ] **誤 reject ledger 記録の整理** — Plan v2 実装前の早計判断で 2 件 reject 記録あり、実体は採用済み (本 handoff で明示)

## Phase 16-D 入力契約 (必須)

### 前提として動くべき機能
- `respondToTransportOrder(db, { invitationId, response, reason? })` が atomic accept/reject 処理
- `pnpm test` 63/63 PASS、typecheck PASS
- `seedTransportStatuses(tx, companyId)` helper が Drizzle 対応で動作
- vendor_users.auth_user_id = auth.uid() で vendor user 解決可能

### 参照すべきファイル
- `src/lib/services/transport-orders.ts` (Phase 19 末尾の `respondToTransportOrder` を vendor portal の server action から呼出予定)
- `src/lib/db/raw-migrations/alpha-1-public/24_vendor_rpcs.sql` (RPC GRANT EXECUTE TO authenticated 済)
- `spec/screen-list.md` (vendor portal URL `/vendor/requests` 仕様)
- `phase-handoff/phase-16-vendor-loop-plan.md` line 88-98 (16-D vendor portal 仕様)

### 絶対に壊してはいけないもの (invariants)
- `RespondToTransportOrderInput` / `RespondToTransportOrderResult` / 5 error class export 名 (test 参照)
- RPC `respond_to_transport_order(uuid, text, text)` シグネチャ + GRANT EXECUTE TO authenticated
- `seedTransportStatuses` の戻り値 `{ requested, accepted, rejected }` (Phase 18 + 19 共通)
- audit_logs trigger 委譲方針 (RPC/service 内手動 INSERT 禁止)
- `pnpm test` 63/63 維持

### 推奨される次 Phase スコープ (16-D)
- vendor portal layout + login + requests 一覧 + 詳細 + accept/reject server action (`/vendor/requests` 配下)
- vendor user 認証 (`vendor_users.auth_user_id = auth.uid()` 解決経路)
- RLS 経由の invitation 一覧表示 (`current_vendor_id()` + `vendor_invited_transport_order_ids()` helper)
- accept/reject submit が `respondToTransportOrder` を呼出
- UI 二重 submit 対策 (409 表示 or button disable)
- frontend は `codex exec --profile-v2 frontend` で委任

### 注意点・コンテキスト
- vendor portal は `(vendor-portal)` route group で社内 admin UI と分離
- vendor_users.auth_user_id は Supabase auth.uid() と紐付け (Phase 14/15 で reconcile 済)
- 16-D 完了後に 16-E (integration test + staging smoke) → Phase 20+ で β 着手

## Codex ledger refs

- del-20260524-125544-f9af (Phase 19 計画 adversarial review, applied)
- del-20260524-130741-44d3 (DDL, 初期 reject 後実体採用)
- del-20260524-130804-6ebd (helper Drizzle 化, 初期 reject 後実体採用)
- del-20260524-131904-6303 (service 関数追記, applied)
- (unit test Task) ac1dacaab3a8e7859 (applied)
- (integration test Task) adaff6b35766a6a47 (applied)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 commit 数 | 0 (本 phase は uncommitted、次セッションでまとめて commit) |
| 追加コード行数 | +~720 (DDL 151 + service +113 + helper 書換 96 + unit +60 + integration +約 300) |
| 新規ファイル数 | 2 (24_vendor_rpcs.sql / phase-19-plan.md) + 1 sealed handoff (本ファイル) |
| 変更ファイル数 | 4 (transport-orders.ts / seed-transport-statuses.ts / unit test / integration test) + 2 (CLAUDE.md / spec/CLAUDE.md 版齟齬解消) |
| Codex 委任率 | 100% (6 Task 全委任 + 1 件 adversarial review) |
| pnpm test | 63/63 PASS (Phase 18 49 → +14) |
| セッション数 | 1 |

## Phase 振り返りメモ

- **うまくいったこと**:
  - Codex adversarial review が plan v1 の致命的問題 (StatusTransitionError コード誤、auth context 未設計、hybrid 集中度低) を早期検出。Plan v2 で修正してから実装に入ったため手戻りゼロ
  - Codex Windows sandbox は Write/Edit 全件通過 (Phase 18 と同じ部分復旧)、shell 実行のみ failed で Claude 側 pnpm 実行で代替
  - 単一 RPC 集中設計で atomic 性向上 + service 層は薄い wrapper でテスト分離容易
  - Phase 18 既存 test refactor を同 phase に組み込むことで DRY 達成、後続 phase の認知負荷削減
  - 63/63 PASS で α-3 Day 2 業者ループ縦切りの応答経路 closing
- **次回改善したいこと**:
  - 序盤に Codex Task 完了 hook の auto-apply 表示を誤読して reject CLI を発火してしまった (実体は採用済み)。ledger 記録の整合性に注意
  - integration test 1 件で 14 ケースを 1 Task に集約したのは 8 分超で時間長め、unit/integration 別 Task の並列化は維持しつつ大規模 test は 2 Task に分割検討

---

*Generated by phase-handoff skill / Filled by Claude at Phase 19 seal (2026-05-24)*
