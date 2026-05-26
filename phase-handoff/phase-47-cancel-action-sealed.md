# Phase 48 入力契約: Phase 47 §1.5 cancel action sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 47 (前: 46 sealed) |
| 状態 | **sealed** (typecheck clean / 17 test files / 148 tests PASS / lint clean) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (scope 確定 + Codex adversarial review 統合 + isNaN 2 件修正) / Codex (4 委任: review / service T1 / page+action T2 / test T3) |
| 前 handoff | `phase-46-transport-order-detail-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 46 from `490caf3`、Phase 47 +1 commit 予定) |

## 達成したこと (Phase 47)

- **§1.5 cancel action** (副作用 5 系統 1 transaction) を縮小版で実装
  - status / status_history / invitations bulk revoke / order-level outbox 1 件 / `respondToTransportOrder` + `respondToSpotInvitation` の terminal guard
- **service 層拡張**: `src/lib/services/transport-orders.ts` (838 → ~1090 行、+250)
  - `cancelTransportOrder(db, companyId, userId, input)` 新規
  - 5 error class: `ConcurrentTransportOrderCancelError` / `AlreadyCancelledError` / `TerminalStatusCancelError` / `TransportOrderNotFoundError` / `CancelStatusSeedMissingError`
  - `respondToTransportOrder` に terminal/cancelled guard 追加 (差分最小)
  - `TransportOrderDetail` interface に `version: number` 追加 (`getTransportOrderDetail` SELECT に `t.version` 追加)
- **spot 経路拡張**: `src/lib/services/spot-invitations.ts` (+14)
  - `respondToSpotInvitation` にも terminal/cancelled guard 追加 (T1 scope 拡張、cancel/accept race 両経路防止)
- **server action 新規**: `src/app/admin/transport-orders/[id]/actions.ts` 36 行 (`cancelTransportOrderAction`, `getAdminUser()` 再認証 Phase 45 pattern)
- **detail page 拡張**: `src/app/admin/transport-orders/[id]/page.tsx` (+38) — キャンセル section + reason form
- **test seed 拡張**: `tests/_helpers/seed-transport-statuses.ts` (+29) — `cancelled` key (isTerminal=true) + status_transitions 3 件追加 (accepted/requested/rejected → cancelled)
- **integration test 12 件追加**: `tests/integration/services/transport-orders-cancel.integration.test.ts` 新規 (+~400 行、全 pass)
- **Codex adversarial review 実施** (NO-GO 判定、BLOCK 2 / WARN 5 / ALT 1+2 採用 → 改訂版で GO)

## Claude 側の主要設計判断

1. **scope 縮小** (Phase 46 handoff 過小評価を是正): 副作用 4 → 5 件 (Codex BLOCK 2 補完で respondToTransportOrder guard 追加)、reservation 遷移 / production status seed / worker 展開 / change_type migration は OUT (MVP blocker 明示)
2. **ALT 1 採用 (1 件 order-level outbox)**: invitation 単位 N 件 → 1 件、idempotency_key `to:{toId}:cancelled:v{version}` (spec §1583 準拠)、衝突面積最小
3. **ALT 2 採用 (target_type='vendor' 維持)**: DB CHECK constraint (`vendor/customer/store_user`) + worker 契約整合、migration 不要、target_id = transport_orders.vendor_id (既存 createTransportOrderWithNotification と同 pattern)
4. **BLOCK 2 採用 (全 invitation revoke)**: `response IN ('pending','accepted')` で bulk revoke (spec §532 整合)、accept race の取りこぼし防止
5. **respondToTransportOrder + respondToSpotInvitation の terminal guard 追加** (BLOCK 2 補完): cancel 後の accept を両経路で StatusTransitionError throw
6. **terminal 判定は `statuses.isTerminal`** (WARN 1): hard-coded 禁止、status table が真実の源
7. **expectedVersion fail 4-way 分岐** (WARN 3): NotFound / Stale / AlreadyCancelled / Terminal 各 error class、UX + 再試行性
8. **reason 1000 文字 + PII は別 Phase** (WARN 5 部分採用): 監査用途短すぎ防止、PII redaction は Phase 45 last_error 共通課題に統合
9. **change_type なし** (WARN 2): from/to/reason/changed_by で十分、column 追加 migration は別 Phase
10. **inline form + confirm dialog なし** (INFO 2 + 簡略化): server component 制約により confirm dialog OUT、赤色 UI で危険性示唆

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-141610-8b39 | adversarial review (BLOCK 2 / WARN 5 / INFO 2 / ALT 2) | 採用 (BLOCK 全採用、WARN 全採用 (1 部分)、ALT 1+2 採用) |
| del-20260526-142659-8cd2 | T1 service `cancelTransportOrder` + 5 error class + `respondToTransportOrder` guard + spot 経路 guard + test seed | applied (Claude 側 2 件修正: `isNaN` → `Number.isNaN`) |
| del-20260526-142707-7209 | T2 page+action: detail page cancel section + server action + `TransportOrderDetail.version` | applied (修正不要) |
| del-20260526-142717-5a45 | T3 integration test 12 件 | applied (修正不要、全 pass) |

**Codex 出力品質**: Phase 43→44→45→46→47 で 0→0→0→0→1→**2** 引き取り。Phase 47 で 2 件引き取りは前 Phase 46 反省 (「isNaN 禁止」明記) を委任プロンプトに含めたにも関わらず T1 が見落とした。Phase 48+ では委任プロンプトに **既存類似 helper の参照 (例: `expectNumber`)** を明記して新規 helper 自体の追加を抑制する。

## Phase 41-47 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-15 | Phase 31-A〜46 | 39-46 | (前 sealed.md 参照) |
| **16** | Phase 16-B 以降 cancel action 不在 | **47** | §1.5 cancel action (副作用 5 系統 1 transaction、order-level outbox 1 件) |
| **17** | Phase 47 持ち越し regression 防止 | **47** | `expectMetricNumber` 内 `Number.isNaN` 利用 (新規 `isNaN` 導入回避) |

## 残課題 / Phase 48 todo (MVP blocker 4 件明示)

### MVP blocker (本番動作前に必須整備)

- **MVP blocker 1**: production status seed 経路 (`createCompanyWithDefaults` service 未実装) — cancel action は本番で `CancelStatusSeedMissingError` throw、test 環境のみ動作
- **MVP blocker 2**: 関連 reservation cancel 遷移 — reservation service 自体未実装、spec §1.5 「依頼キャンセル→関連予約もキャンセル」未対応
- **MVP blocker 3**: Worker 側 `transport_order.cancelled` event handler — outbox row 1 件作成までで停止、payload.revokedInvitations 展開して各 vendor へ N 通通知メール送信は worker enhancement 別 Phase
- **MVP blocker 4**: `status_history.change_type` column 追加 migration — spec/data-model.md §3.11 言及あるが schema 未存在

### 一般 todo

- §1.5 残 action: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / 招待 revoke / token URL 再発行
- §1.5 store name 表示 (Phase 46 持ち越し)
- §1.5 招待管理ビュー単独 page
- §1.8 last_error PII redaction (cancel.reason も対象、共通課題)
- §1.8 拡張: notification_deliveries 書込み / requeue_count column / 担当者割当 / エスカレーション / Slack
- §1.8 表示文言整備
- §1.1 業務優先一覧テーブル (Phase 44 持ち越し)
- §1.4 店間整備依頼 admin UI (大規模、service 先行)
- 本番デプロイ前の Supabase URL Configuration 更新
- `probe-invite-link.ts` CI 組み込み
- vendor 側 E2E 拡張 (callback 込み)
- spec/data-model.md に admin_vendor_invitations 定義追加
- branch merge `phase-42-t4-test-coverage` → `phase-26-ci-verify`
- headquarters_admin role 分離検討
- `expectMetricNumber` 重複疑い (既存 `expectNumber` と機能重複の可能性、後続精査)

## Phase 48 入力契約

### 推奨される次 Phase スコープ

1. **Worker 側 `transport_order.cancelled` event handler** (MVP blocker 3 解消、Inngest function 追加で N 通通知メール送信、Resend + React Email)
2. **§1.5 store name 表示** (軽微、副作用なし、Phase 46+47 続きで自然)
3. **§1.5 vendor_change action** (副作用、業者変更で再通知 outbox + 既存 invitation revoke)
4. **§1.1 業務優先一覧テーブル** (Phase 44 持ち越し、副作用なし)
5. **production status seed 経路 `createCompanyWithDefaults`** (MVP blocker 1 解消、基盤整備)

### 参照すべきファイル

- 本 handoff (`phase-47-cancel-action-sealed.md`)
- `phase-46-transport-order-detail-sealed.md` (前 Phase)
- `phase-47-cancel-action-plan.md` (改訂 plan、Codex review 採否一覧)
- `.tmp/codex-review-phase47-output.md` (Codex review 全文)
- `src/lib/services/transport-orders.ts` (cancelTransportOrder lines ~840-1090、respondToTransportOrder guard、TransportOrderDetail.version 追加)
- `src/lib/services/spot-invitations.ts` lines 83-103 (terminal guard)
- `src/app/admin/transport-orders/[id]/actions.ts` (Phase 47 server action 36 行、`getAdminUser()` 再認証)
- `src/app/admin/transport-orders/[id]/page.tsx` (Phase 46+47 detail page ~356 行、cancel section)
- `tests/_helpers/seed-transport-statuses.ts` (cancelled status + 3 transitions、Phase 47 拡張済)
- `tests/integration/services/transport-orders-cancel.integration.test.ts` (Phase 47 cancel test 12 件、race + concurrent 含む)

### 絶対に壊してはいけないもの (invariants)

- 既修正 17 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 148 tests PASS
- CI E2E 7/7 PASS (Phase 48 で CI 確認時に維持)
- 既存 invariants: `AdminDashboardMetrics` (P44) / `TransportOrderListItem` (P43) / `FailedNotificationListItem` + `requeueFailedNotification` (P45) / `TransportOrderDetail` + `getTransportOrderDetail` (P46)
- server action 内 `getAdminUser()` 再認証必須 (P45 W5)
- companyId はサーバー側 admin user から取得 (URL/searchParams 不可)
- **`cancelTransportOrder` semantic (Phase 47 確定)**: 5 副作用 1 transaction 包、idempotency_key `to:{toId}:cancelled:v{newVersion}`、全 invitation (pending+accepted) revoke、`statuses.isTerminal` で terminal 判定 (hard-coded 禁止)、target_type='vendor' / target_id=transport_orders.vendor_id 維持
- **`respondToTransportOrder` + `respondToSpotInvitation` terminal guard** (Phase 47 確定): cancel/accept race 防止のため両経路に必須
- **`TransportOrderDetail.version: number` (Phase 47 確定)**: page expectedVersion で利用、削除禁止
- **outbox payload schema (Phase 47 確定)**: `{ transportOrderId, cancelledAt, reason, revokedInvitations: [{ invitationId, vendorId, inviteeEmail, responseBefore }] }`、worker 側展開で N 通通知メールの payload contract

### 注意点・コンテキスト

- branch: `phase-42-t4-test-coverage` (Phase 47 commit +1 予定、Phase 46 `490caf3` から)
- Phase 47 変更ファイル: 4 modify + 2 new = 6 files (handoff plan + sealed 含めて +8 files)
  - `src/lib/services/transport-orders.ts` (+250 +5 +2 fix)
  - `src/lib/services/spot-invitations.ts` (+14、scope 拡張で T1 自発的追加)
  - `src/app/admin/transport-orders/[id]/page.tsx` (+38)
  - `tests/_helpers/seed-transport-statuses.ts` (+29)
  - `src/app/admin/transport-orders/[id]/actions.ts` (+36 new)
  - `tests/integration/services/transport-orders-cancel.integration.test.ts` (+~400 new)
- Codex adversarial review 5 度目 (NO-GO → 改訂版で GO、初の NO-GO 判定で大幅 scope 改訂)
- Codex 引き取り 2 件 (前 Phase 46 1 件、上昇傾向): Phase 48+ で対策 (helper 重複検出 + isNaN/Number.isNaN 委任プロンプト強化)

## Codex ledger refs

- del-20260526-141610-8b39 (adversarial review)
- del-20260526-142659-8cd2 (T1 service)
- del-20260526-142707-7209 (T2 page+action)
- del-20260526-142717-5a45 (T3 integration test)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 47 commit 数 | 1 (予定) |
| 変更ファイル | 4 M + 2 A = 6 files |
| 修正済 latent bug / 機能追加 | 2 (#16 cancel action / #17 isNaN regression 防止 — 累積 17) |
| advisor 呼び出し | 1 (scope 縮小判断、status seed blocker 確認) |
| Codex 委任 task 数 | 4 (adversarial review / service / page+action / integration test) |
| Codex sandbox-blocked 率 | 0/4 (apply_patch 経路で安定、vitest は Claude 側で `npm run test:all` 実行) |
| Codex exec stdin hang | 0 件 |
| Claude 側修正 (Codex 出力) | **2** (`isNaN` → `Number.isNaN` 2 箇所、Phase 46 反省ルール違反) |
| test files | 16 → 17 (+1 cancel) |
| integration + unit test 件数 | 136 → **148** (+12 cancel test 全 pass) |
| 新規 service 関数 | 1 (cancelTransportOrder) |
| 既存 service 関数修正 | 2 (respondToTransportOrder / respondToSpotInvitation guard) |
| 新規 error class | 5 (ConcurrentTransportOrderCancelError / AlreadyCancelledError / TerminalStatusCancelError / TransportOrderNotFoundError / CancelStatusSeedMissingError) |
| 新規 server action | 1 (cancelTransportOrderAction) |
| MVP blocker 明示 | 4 (status seed / reservation 遷移 / worker 展開 / change_type migration) |

## 振り返りメモ

- **adversarial review 5 連続実施、初の NO-GO 判定**: Phase 46 handoff の cancel scope 見積もり (副作用 1 件) を Codex が即座に否定 (実態 4-7 件 + DB CHECK 違反)。`/codex:adversarial-review` のレビュー精度が機能。本番投入前に migration unwind と worker 契約改修を回避できた
- **scope crisp 化の限界**: 「副作用最小」を信じすぎると semantic 不整合のリスク。Phase 48+ では計画書段階で **副作用列挙 + 既存 DB CHECK + worker 契約 + spec semantic 全部確認** を planner 標準化
- **Codex 引き取り 2 件発生**: Phase 46 反省ルール (isNaN → Number.isNaN) を委任プロンプトに明記したが T1 が新規 helper `expectMetricNumber` で見落とし。**Phase 48+ ルール改訂: 委任プロンプトに「既存 helper (`expectNumber`/`expectString`/`expectBoolean`/`expectNullableDate`) を優先利用、類似 helper 新規追加は禁止」を追加**
- **MVP blocker 4 件の明示化**: handoff invariants に格上げ。次 Phase planner が cancel action を「done」と誤判定する余地を消す。特に worker 展開 (blocker 3) は payload contract で抑制
- **scope 拡張で spot 経路にも guard 追加 (T1 自発判断)**: BLOCK 2 補完で respondToTransportOrder + respondToSpotInvitation 両方に terminal guard。scope 外だが semantic 整合のため採用、test 148 件 PASS で regression なし確認

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 47 完了、累積 17 機能追加 + §1.5 cancel action 縮小版、MVP blocker 4 件明示)*
