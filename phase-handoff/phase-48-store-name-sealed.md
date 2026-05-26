# Phase 49 入力契約: Phase 48 §1.5 store name 表示 sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 48 (前: 47 sealed) |
| 状態 | **sealed** (typecheck clean / 17 test files / 148 tests PASS) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + plan + 統合検証 + commit + seal) / Codex (1 委任: T1 service+UI+test 一括) |
| 前 handoff | `phase-47-cancel-action-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 47 `e19d9b5` から +1, HEAD `3ad95a2`) |

## 達成したこと (Phase 48)

- **§1.5 store name 表示** (詳細 + 一覧、副作用 0 / migration 0 / breaking 0)
  - `listTransportOrdersWithLatestInvitation` / `getTransportOrderDetail` SELECT に LEFT JOIN stores x3 (`ps` / `ds` / `rs`)
  - `TransportOrderListItem` / `TransportOrderDetail` に `pickupStoreName` / `deliveryStoreName` / `returnStoreName: string | null` 追加 (additive only)
- **一覧 page** (`src/app/admin/transport-orders/page.tsx`):
  - 「移動経路」column 追加 (「移動パターン」右側)
  - `formatRoute(order)` helper: movement_type 別 `引取 → 納車`/`引取 → 納車 → 返却`/`引取`/三点
- **詳細 page** (`src/app/admin/transport-orders/[id]/page.tsx`):
  - 「引取店舗 / 納車店舗 / 返却店舗」DetailField 3 件追加
  - 既存「引取店舗ID / 納車店舗ID / 返却店舗ID」は副次として保持 (Phase 46 invariant 維持)
- **integration test 拡張** (新規 test file なし):
  - `tests/integration/services/transport-orders.integration.test.ts`: stores seed 名称 → `引取店舗A` / `納車店舗A` + list assertion 追加
  - `tests/integration/services/transport-orders-detail.integration.test.ts`: returnStore seed + 紐付け + 3 name assertion 追加
- **Codex 委任 T1 (1 件)**: service+UI+test 一括、apply 一発成功、引き取り 0 件

## Claude 側の主要設計判断

1. **adversarial review skip**: 副作用 0 / migration 0 / breaking 0 / DB CHECK 0 で Phase 47 とは scope の質が違う、過小評価リスク低と判定
2. **3 LEFT JOIN alias 統一** (`ps` / `ds` / `rs`): pickup_store / delivery_store / return_store の頭文字、SQL 可読性
3. **`s.deleted_at` 条件付けない**: 削除済 store でも履歴として name 表示 (stores.deleted_at は新規割当禁止のみ)
4. **additive only 維持**: 既存 field `pickupStoreId` / `deliveryStoreId` / `returnStoreId` を削除せず name を併存 (Phase 46/47 invariant)
5. **既存 helper `expectNullableString` 利用**: Phase 47 反省で「新規 helper 追加禁止」を委任プロンプトに明記、Codex 100% 遵守
6. **詳細 page 順序**: 既存「DetailField 群」末尾に name 3 件 → ID 3 件の順で配置 (Codex 判断採用、UI 流れ妥当)
7. **一覧 column 位置**: 「移動パターン」右 (Codex 採用、movement_type と route が論理的に近い)
8. **3 並列委任不採用**: Phase 47 は scope 大で 3 並列、Phase 48 は scope 軽微で 1 委任 (T1 単独で完結)、統合複雑度低減

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-150120-75e4 | T1 service+UI+test 一括 (5 file: service / list page / detail page / list test / detail test) | applied (修正不要、引き取り 0 件) |

**Codex 出力品質**: Phase 43→44→45→46→47→48 で 0→0→0→0→1→2→**0** 引き取り。Phase 47 反省ルール (既存 helper 優先 / Number.isNaN / additive only) を委任プロンプトに **明示列挙** したことで Codex が 100% 遵守。

**Codex sandbox 状況**: T1 で Codex 側 `pnpm vitest run` が `spawn setup refresh` で起動不可 (Phase 41-T1 で診断済の Windows 制約)。**apply_patch は 5 file 全件成功**、Claude 側 `npm run test:all` で 148 tests PASS 確認。Codex shell 経由検証は引き続き Claude 側に集約。

## Phase 41-48 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-15 | Phase 31-A〜46 | 39-46 | (前 sealed.md 参照) |
| 16 | Phase 16-B 以降 cancel action 不在 | 47 | §1.5 cancel action (副作用 5 系統 1 transaction、order-level outbox 1 件) |
| 17 | Phase 47 持ち越し regression 防止 | 47 | `expectMetricNumber` 内 `Number.isNaN` 利用 |
| **18** | Phase 46 持ち越し store ID 直表示 | **48** | §1.5 store name 表示 (詳細・一覧、JOIN x3) |

## 残課題 / Phase 49 todo

### MVP blocker (本番動作前に必須整備、Phase 47 から継続)

- **MVP blocker 1**: production status seed 経路 (`createCompanyWithDefaults` 未実装) — Phase 50 候補
- **MVP blocker 2**: 関連 reservation cancel 遷移 — reservation service 自体未実装
- **MVP blocker 3**: Worker 側 `transport_order.cancelled` event handler — outbox row 1 件作成までで停止
- **MVP blocker 4**: `status_history.change_type` column 追加 migration

### 一般 todo (Phase 47 から継続)

- §1.5 残 action: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / 招待 revoke / token URL 再発行
- §1.5 招待管理ビュー単独 page
- §1.8 last_error PII redaction (cancel.reason も対象)
- §1.8 拡張: notification_deliveries 書込み / requeue_count column / 担当者割当 / エスカレーション / Slack
- §1.8 表示文言整備
- **§1.1 業務優先一覧テーブル** (Phase 44 持ち越し、Phase 49 候補)
- §1.4 店間整備依頼 admin UI (大規模、service 先行)
- 本番デプロイ前の Supabase URL Configuration 更新
- `probe-invite-link.ts` CI 組み込み
- vendor 側 E2E 拡張 (callback 込み)
- spec/data-model.md に admin_vendor_invitations 定義追加
- branch merge `phase-42-t4-test-coverage` → `phase-26-ci-verify`
- headquarters_admin role 分離検討
- `expectMetricNumber` 重複疑い (既存 `expectNumber` と機能重複、後続精査)

## Phase 49 入力契約

### 推奨される次 Phase スコープ (handoff 順 #4 採用予定)

1. **§1.1 業務優先一覧テーブル** (Phase 44 持ち越し、`listTransportOrdersWithLatestInvitation` 再利用 + filter、副作用なし) ← **Phase 49 採用候補**
2. Worker 側 `transport_order.cancelled` event handler (MVP blocker 3、本番依存で wake-up 待機推奨)
3. §1.5 vendor_change action (副作用、Phase 50+ で wake-up 確認後)
4. production status seed 経路 (MVP blocker 1、Phase 50 で advisor 再判断)

### 参照すべきファイル

- 本 handoff (`phase-48-store-name-sealed.md`)
- `phase-47-cancel-action-sealed.md` (前 Phase)
- `phase-48-store-name-plan.md` (Phase 48 plan)
- `src/lib/services/transport-orders.ts`
  - `listTransportOrdersWithLatestInvitation` (Phase 48 で stores JOIN 拡張済)
  - `TransportOrderListItem` (Phase 48 で pickup/delivery/returnStoreName 追加)
  - `getAdminDashboardMetrics` / `AdminDashboardMetrics` (Phase 44、Phase 49 でも再利用候補)
- `src/app/admin/transport-orders/page.tsx` (Phase 48 で移動経路 column 追加)
- `src/app/admin/dashboard/page.tsx` (Phase 44 dashboard、Phase 49 で業務優先テーブル追加候補)

### 絶対に壊してはいけないもの (invariants)

- 既修正 18 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 148 tests PASS
- CI E2E 7/7 PASS (Phase 49 で CI 確認時に維持)
- 既存 invariants: `AdminDashboardMetrics` (P44) / `TransportOrderListItem` (P43/P48) / `FailedNotificationListItem` + `requeueFailedNotification` (P45) / `TransportOrderDetail` + `getTransportOrderDetail` (P46/P48)
- server action 内 `getAdminUser()` 再認証必須 (P45 W5)
- companyId はサーバー側 admin user から取得 (URL/searchParams 不可)
- **`TransportOrderListItem` / `TransportOrderDetail` に `pickupStoreName` / `deliveryStoreName` / `returnStoreName: string | null` (Phase 48 確定)**: 削除禁止、`expectNullableString` で parse
- **stores LEFT JOIN alias `ps` / `ds` / `rs`** (Phase 48 確定): SELECT 拡張時に alias 衝突回避
- **`stores.deleted_at` 条件付けない pattern** (Phase 48 確定): 削除済 store も name 表示 (履歴保護)
- **`cancelTransportOrder` semantic / outbox payload schema** (Phase 47 確定)
- **`respondToTransportOrder` + `respondToSpotInvitation` terminal guard** (Phase 47 確定)
- **`TransportOrderDetail.version: number`** (Phase 47 確定)

### 注意点・コンテキスト

- branch: `phase-42-t4-test-coverage` (Phase 48 commit `3ad95a2`、Phase 47 `e19d9b5` から +1)
- Phase 48 変更ファイル: 5 modify + 1 new = 6 files
  - `src/lib/services/transport-orders.ts` (+30)
  - `src/app/admin/transport-orders/page.tsx` (+27)
  - `src/app/admin/transport-orders/[id]/page.tsx` (+3)
  - `tests/integration/services/transport-orders.integration.test.ts` (+7 -2)
  - `tests/integration/services/transport-orders-detail.integration.test.ts` (+11 -3)
  - `phase-handoff/phase-48-store-name-plan.md` (new)
- Codex 委任 1 件 (T1 一括)、apply 一発成功、引き取り 0 件
- adversarial review skip (副作用 0 / migration 0 / breaking 0 / DB CHECK 0)
- Phase 49 候補: 業務優先一覧テーブル (Phase 44 から持ち越し、副作用なし、自律進行に適)

## Codex ledger refs

- del-20260526-150120-75e4 (T1 service+UI+test 一括)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 48 commit 数 | 1 (`3ad95a2`) |
| 変更ファイル | 5 M + 1 A = 6 files |
| 修正済 latent bug / 機能追加 | 1 (#18 store name 表示 — 累積 18) |
| advisor 呼び出し | 1 (scope 確認、推奨順並び替え判定) |
| Codex 委任 task 数 | 1 (T1 一括) |
| Codex sandbox-blocked | 0/1 (apply_patch 経路安定、Codex shell test だけ起動不可、Phase 41 既知制約) |
| Codex exec stdin hang | 0 件 |
| Claude 側修正 (Codex 出力) | **0** (Phase 47 反省ルール 100% 遵守、3 ルールすべて適合) |
| test files | 17 (変化なし、新規 test file 不要、既存 file への assertion 追加) |
| integration + unit test 件数 | 148 (変化なし、既存 test に assertion 追加のみ) |
| 新規 service 関数 | 0 (既存 2 関数の SELECT 拡張) |
| 既存 service 関数修正 | 2 (listTransportOrdersWithLatestInvitation / getTransportOrderDetail SELECT 拡張) |
| 新規 error class | 0 |
| 新規 server action | 0 |
| MVP blocker 解消 | 0 (Phase 48 は MVP blocker 直接解消ではなく UX 改善) |

## 振り返りメモ

- **Phase 47 反省ルールが完全奏効**: 委任プロンプトに「既存 helper 優先 / Number.isNaN / additive only」を **具体列挙** したことで Codex 引き取り 2 → 0 件。**Phase 49+ も同 pattern を継続**
- **adversarial review skip 判断の基準確立**: 副作用 0 / migration 0 / breaking 0 / DB CHECK 0 の 4 条件すべて満たす Phase は skip 妥当。Phase 47 のような scope (副作用 5 系統 / DB CHECK 違反疑い) は必須
- **1 委任で完結 (3 並列不要)**: scope 軽微時の効率化、統合複雑度低減。Phase 47 のような分散 scope では 3 並列継続、Phase 48 のような連続 scope では 1 委任
- **store deleted_at 設計判断**: 履歴保護のため LEFT JOIN 条件に含めない、後続 Phase でも同 pattern (vendors / customers 等の soft delete テーブルにも適用検討)
- **Codex sandbox 制約継続**: vitest 等 Node 系 spawn 不可は Phase 41 既知、apply_patch で実装は OK、検証は Claude 側集約で対応可能
- **handoff 順 #1 (Worker handler) を skip した判断**: 本番依存 (Inngest / Resend) で品質担保困難、Phase 49 業務優先一覧 (副作用 0) で自律進行継続

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 48 完了、累積 18 機能追加 + §1.5 store name 表示、副作用 0)*
