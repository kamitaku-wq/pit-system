# Phase 55 Plan: change_logs service 統合 (cancelTransportOrder)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 55 (前: 54 sealed) |
| 状態 | **planning v2** (Codex adversarial review CONDITIONAL-GO で修正済) |
| 着手日 | 2026-05-27 |
| 担当 | Claude (plan) → Codex (adversarial review) → 実装判断 |
| 前 handoff | `phase-54-sql-function-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (HEAD `e9725fb`) |

## 目的・背景

Phase 53 で `transport_order_change_logs` テーブル schema を spec §7.8 完全準拠に整備したが、
service 統合は OUT として持ち越し。Phase 55 で **cancelTransportOrder** に change_logs INSERT を
組み込み、spec §7.8 + §15.6 (各アクションを change_logs に記録) を service 実装でも担保する。

MVP blocker #4 は Phase 53 で schema 解消済。本 Phase は schema 利活用の **第一歩** として
cancel のみを対象にする (他 change_type は別 Phase: vendor_changed / datetime_changed /
recreated / rejected_reassigned)。

## スコープ (IN)

1. **`cancelTransportOrder` service 改修**: `src/lib/services/transport-orders.ts:412-`
   - **既存 SELECT 拡張** (`currentOrderRow`): `cancelled_at` を追加取得 (BLOCK 3 対応)
   - 既存トランザクション内に `transport_order_change_logs` INSERT 追加 (status_history INSERT の直後、**raw SQL `tx.execute(sql\`INSERT...\`)` で既存と統一** WARN 1)
   - 位置: `updatedOrderRow` 確認後、`status_history` INSERT の直後 (cancel 成功確定後のみ change_log 作成)
   - 列値 (snapshot 4 フィールドに削減、reason 除去 BLOCK 2):
     - `company_id` = `companyId`
     - `transport_order_id` = `parsed.transportOrderId`
     - `change_type` = `'cancelled'`
     - `before_json` = `{ status_id: currentOrderRow.status_id, status_key: currentOrderRow.status_key, version: currentOrderRow.version, vendor_id: currentOrderRow.vendor_id, cancelled_at: currentOrderRow.cancelled_at }` (DB 実値ベース、cancelled_at は仕様上常に null だが SELECT 結果使用)
     - `after_json` = `{ status_id: cancelledStatusId, status_key: 'cancelled', version: updatedOrderRow.version, vendor_id: updatedOrderRow.vendor_id, cancelled_at: cancelledAt.toISOString() }`
     - `changed_by_user_id` = `userId`
     - **`requires_notification` = `false`** (BLOCK 1 対応: 既存 `to:{id}:cancelled:v{ver}` outbox が通知責任、二重通知防止)
     - `notified_at` = `NULL` (worker 不要、`requires_notification=false` で skip)
   - INSERT は `.returning` 不要

2. **integration test 追加**: `tests/integration/services/transport-orders-cancel.integration.test.ts`
   - **成功系 assertion 追加** (絞り込み条件: `company_id + transport_order_id + change_type='cancelled'`):
     - cancel 後に `transport_order_change_logs` row が **1 件** insert される
     - `changed_by_user_id=userId`, `requires_notification=false`, `notified_at=NULL`
     - `before_json.status_key !== 'cancelled'`, `after_json.status_key === 'cancelled'`
     - `before_json.cancelled_at === null`, `after_json.cancelled_at` is ISO timestamp string
     - `before_json.version === currentOrderRow.version (DB 実値)`, `after_json.version === before + 1`
     - `before_json.reason` / `after_json.reason` キーが **存在しない** (reason 除去の retrogression guard)
   - **失敗系 0 件 assertion 追加** (WARN 2 対応):
     - ConcurrentTransportOrderCancelError (version conflict): change_log row 0 件
     - AlreadyCancelledError: change_log row 0 件
     - TerminalStatusCancelError: change_log row 0 件
     - cross-tenant (異 company の transport_order を指定): change_log row 0 件
   - 既存 cancel 系 assertion (status_history / outbox / invitation revoke) は変更なし

3. **typecheck + 全 test green** 確認

## スコープ (OUT)

- 他 change_type 統合 (vendor_changed / datetime_changed / recreated / rejected_reassigned)
- outbox worker での `notified_at` 更新 (worker 自体が wake-up 領域)
- `transport_order.changed` 通知 (`to:{id}:changed:{change_log_id}` 規約) の追加 outbox 投入
  - 理由: 既存 `to:{id}:cancelled:v{ver}` outbox が responsible、二重通知を避ける
- spec §11.2 redaction policy の transport_orders 拡張
  - 理由: `transport_orders` テーブル自体は PII (phone/email/vin) を直接保持しない、最小 snapshot pattern で十分
- E2E test (cancel + change_log 検証) — wake-up 領域

## Claude 設計判断 (v2 — Codex review 反映後)

1. **最小 snapshot pattern (4 フィールド)**: before/after_json は **status_id / status_key / version / vendor_id / cancelled_at** に限定 (reason 除去)
   - 理由 A: cancel は status 遷移イベント、scheduled_at 等の予定情報は変化しない → diff 価値なし
   - 理由 B: 最小化で PII 混入リスクを構造的に回避
   - 理由 C: reason は `status_history.reason` + cancel outbox payload に既に保存、change_log で重複保存しない (Codex BLOCK 2)
   - 理由 D: 将来 datetime_changed では別フィールドセット (scheduled_at, requested_pickup_at) を採用する pattern

2. **requires_notification = false 固定**: 既存 `to:{id}:cancelled:v{ver}` outbox が通知責任を持つため、change_log 由来の通知は不要
   - 二重通知防止: 新規 outbox row は追加しない、worker scan で再投入も発生しない (Codex BLOCK 1)
   - 将来 vendor_changed / datetime_changed は `requires_notification=true` + `to:{id}:changed:{change_log_id}` outbox 投入 pattern を採用予定 (別 Phase)

3. **INSERT は raw SQL で統一**: cancelTransportOrder 全体 (SELECT/UPDATE/status_history/outbox) が raw SQL なので change_log も `tx.execute(sql\`INSERT...\`)` で統一 (Codex WARN 1)

4. **SELECT 拡張で snapshot を DB 実値ベースに**: 既存 `currentOrderRow` SELECT に `cancelled_at` 列追加、固定値書き込みを排除 (Codex BLOCK 3)
   - 業務上 `currentOrderRow.cancelled_at === null` は不変だが、SELECT 結果使用で「snapshot は DB 実値」原則を遵守

5. **change_log INSERT 位置**: `updatedOrderRow` 成功確認後、`status_history` INSERT 直後
   - cancel 失敗ケース (version conflict / already-cancelled / terminal / not-found) では INSERT 走らず、change_log 0 件で正しい (test で 0 件 assert)

6. **helper 抽出は後で**: 現状 cancel 1 種類のみ、Phase 56+ で vendor_changed / datetime_changed 追加時に共通 helper (`insertTransportOrderChangeLog(tx, ...)`) を抽出
   - 早期抽出は YAGNI、cancel 専用 INSERT 30 行で出発

7. **Codex 委任判定**: 実装本体 30-40 行 (snapshot 構築 + raw SQL INSERT)、既存トランザクション深い context、Claude 自実装の方が安全
   - test 追加 (40-80 行) は **強制委任ルール対象** (tests/ 10 行以上) だが、既存 test ファイルへの assertion 追加 = 既存パターン継承、Claude 自実装でも品質維持可
   - 最終判断: **Claude 自実装** (Phase 47-54 で確立した「既存 service 追記は Claude」規律継続)、override reason: `architecture-decision-extension` (既存 raw SQL pattern 継承)

## TDD 順序

1. **RED**: 既存 cancel test に change_log assertion 追加 → 落ちる
2. **GREEN**: cancelTransportOrder に INSERT 追加 → 通る
3. **REFACTOR**: 必要に応じてヘルパー抽出 (現時点ではなし、将来横展開時に検討)

## 既知のリスク

| # | リスク | 対策 |
|---|---|---|
| R1 | snapshot フィールド漏れ (spec §7.8 詳細欠如) | 最小 4 フィールドで開始、横展開時に追加可 |
| R2 | INSERT 失敗で cancel 全体が rollback | 既存トランザクション内なので **意図通り** (整合性優先) |
| R3 | redaction 漏れ (将来別 entity 統合時) | OUT 明記、別 Phase で redact_transport_order_payload 関数追加検討 |
| R4 | 既存 152 tests への retrogression | TDD で局所的に追加、全 test 実行で検証 |
| R5 | notified_at が永遠に NULL (worker 未実装) | cancel は `requires_notification=false` で worker scan 対象外、二重通知発生せず (Codex BLOCK 1 解消) |
| R6 | `changed_by_user_id` の company 整合 schema CHECK 欠如 (Codex WARN 4) | admin role middleware で `companyId` 保証、schema CHECK 追加は別 Phase 検討 |

## 参照ファイル

- `src/lib/services/transport-orders.ts:412-` (cancelTransportOrder 既存)
- `src/lib/db/schema/transport_order_change_logs.ts` (Phase 53)
- `src/lib/db/schema/transport_order_status_history.ts` (history pattern 参考)
- `tests/integration/services/transport-orders-cancel.integration.test.ts` (test 追加先)
- `src/app/admin/transport-orders/[id]/actions.ts` (Server Action、変更不要)
- spec/data-model.md §7.8 (change_logs schema), §11.2 (redaction policy), §15.6 (各アクション記録要件)
- spec/requirements.md L548, L600, L672, L683 (change_logs 業務要件)

## 主要メトリクス目標

| 指標 | 目標 |
|---|---|
| 変更ファイル | 2 (service + test) |
| 新規 migration | 0 (schema は Phase 53 完了) |
| 新規行数 | service 30-40 行 + test 40-80 行 (失敗系 4 ケース含む) = 計 70-120 行 |
| typecheck | clean 維持 |
| 既存 test | 17 files / 152 tests PASS 維持 |
| 新規 test | +5〜+8 assertion (成功系 + 失敗系 4 種の 0 件 assert) |
| Codex 委任 | adversarial review 1 (完了 `del-20260527-012705-35d2`) + 実装 0 = 1 件 |
| advisor 呼び出し | 0 (Codex review 採用で十分) |
| MVP blocker 解消 | 0 (#4 は Phase 53 で解消済、本 Phase は service 統合) |

## 次ステップ

1. ~~**Codex adversarial review** (`/codex:adversarial-review`) で plan 第二意見~~ ✅ 完了 (`del-20260527-012705-35d2`, CONDITIONAL-GO)
2. ~~レビュー結果統合 → 修正 plan~~ ✅ v2 で反映 (BLOCK 3 + WARN 4 採用、1 件は別 Phase)
3. **ユーザー approval** ← 現在ここ
4. TDD で実装: RED (test 追加で fail) → GREEN (service INSERT 追加) → typecheck → 全 test
5. Phase 55 seal (handoff 書き出し + commit)

## Codex Review Summary (`del-20260527-012705-35d2`)

判定: CONDITIONAL-GO

| 採用 | 内容 |
|---|---|
| ✅ BLOCK 1 | `requires_notification=false` (二重通知防止) |
| ✅ BLOCK 2 | `reason` snapshot から除去 (status_history/outbox に重複) |
| ✅ BLOCK 3 | SELECT 拡張で `cancelled_at` DB 実値ベース |
| ✅ WARN 1 | raw SQL 統一 |
| ✅ WARN 2 | failed cases 0 件 assert 追加 |
| ✅ WARN 3 | schema import 不要 (raw SQL) — plan に明記 |
| ⚠️ WARN 4 | `changed_by_user_id` company CHECK は別 Phase (admin role middleware で保証) |
| ✅ WARN 5 | DB 実値ベース version assert |
| ✅ 改善案 | helper 抽出は後で (YAGNI、Phase 56+ で実施) |

---

*Phase 55 plan v2 / drafted 2026-05-27 by Claude / Codex CONDITIONAL-GO 反映 / awaiting user approval*
