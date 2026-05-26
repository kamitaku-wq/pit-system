# Phase 45 入力契約: Phase 44 §1.1 admin Dashboard 実データ化 sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 44 (前: 43 sealed) |
| 状態 | **sealed** (typecheck clean / unit 35 / integration 93 PASS) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (scope 確定 + 設計判断 + Codex 出力レビュー) / Codex (3 件委任: service / page.tsx / integration test) |
| 前 handoff | `phase-43-transport-orders-ui-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 43 from `fa313e9`) |

## 達成したこと (Phase 44)

- **§1.1 admin Dashboard 実データ化** を縦切り最小で実装
  - 3 カード表示: 未確認業者依頼 / 対応不可 / 遅延案件 (spec/requirements.md §26 line 841 の文言)
- **service 層拡張**: `getAdminDashboardMetrics(db, companyId)` を追加。1 SELECT で 3 つの `COUNT(*) FILTER (WHERE ...)` を返却
- **integration test 2 件追加**: tenant 隔離 / 3 指標 (pending / rejected / delayed) の正当性 (全 pass)
- **遅延案件の SQL 定義確定**: `vendor_response = 'pending' AND notification_sent_at < now() - interval '24 hours'`

## Claude 側の主要設計判断

1. **§1.1 Dashboard を選択**: handoff 推奨順 #1 (read-only / 1 Phase で確実 / §1.5 列挙ロジック相当の service を再利用)。advisor も「呼ばずに進めて良い」と判定 (spec §26 line 841 に 3 指標明示済)
2. **新規 service 関数として追加 (既存破壊なし)**: invariant の `TransportOrderListItem` 型・`listTransportOrdersWithLatestInvitation` 関数は触らない。`getAdminDashboardMetrics` を末尾に追加のみ
3. **遅延案件は A 案 (業者応答 24h 超) に絞り B/C は除外**: advisor 助言通り、1 指標に絞って Phase 44 縦切り維持。`requested_pickup_at` 系の遅延判定は Phase 45+ で拡張
4. **3 カード全置換 (拡張ではない)**: 既存モック「本日の予約 / 稼働ピット / 未確認通知」は §1.4 reservations/pits 領域で service 未整備 → 完全置換が縦切り最小
5. **Codex 委任を 3 件すべて subagent 経路で実行**: Phase 43 で確立した「codex exec 直接 stdin hang → Task(codex:codex-rescue) subagent 推奨」を default 化 (3/3 applied、stdin hang 0 件)

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-112817-6caa | getAdminDashboardMetrics service 追加 (interface + parser + 関数) 64 行 | applied (修正不要) |
| del-20260526-113139-c8d3 | dashboard/page.tsx 全面書き換え 62 行 | applied (修正不要) |
| (上記 del-20260526-113139-c8d3 と並列実行) | integration test 2 件 109 行 | applied (修正不要) |

**Codex 出力品質**: Phase 43 では Claude 引き取り 4 件 (SQL alias / TS narrowing / TS2532 / React key) あったが、Phase 44 は **0 件**。Codex に渡す prompt で「既存パターン mirror 元の line 番号を明示」「invariant 列挙」「`既存 test (line 213-643) を読んで確認してから書く` 等の anti-推測指示」が効いた可能性

## Phase 41-44 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-10 | Phase 31-A/B/C/D + 40 + 41 | 39-42 | (phase-43-sealed.md 参照) |
| 11 | Phase 16-B 以降 UI 不在 | 43 | §1.5 業者通知・回送管理 一覧 UI 縦切り |
| **12** | Phase 8 以降 Dashboard モック | **44** | §1.1 Dashboard 実データ化 (運用優先 3 指標) |

## 残課題 / Phase 45 todo

- **§1.1 拡張**: requested_pickup_at ベースの遅延 / 期間フィルタ / グラフ表示 / 「業務優先一覧」テーブル (spec §26 line 841 後段)
- **§1.5 残機能**: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / キャンセル / CSV / 招待 revoke / 通知履歴 / 詳細ページ `[id]` (Phase 43 から継続)
- **§1.4 店間整備依頼 admin UI**: service_ticket/vehicle service 先行 (大規模)
- **§1.8 通知失敗・運用画面**: outbox.status='failed' 一覧 + 手動再送 (Phase 43 から継続)
- **本番デプロイ前の Supabase URL Configuration 更新** (Phase 41 から継続)
- **`probe-invite-link.ts` を CI に組み込むか?** (Phase 41 から継続)
- **vendor 側 E2E 拡張**: callback も叩く E2E (Phase 41 から継続)
- **spec/data-model.md に admin_vendor_invitations 定義追加** (Phase 42 から継続)
- **branch merge**: `phase-42-t4-test-coverage` → `phase-26-ci-verify` への merge は未実施 (Phase 42 から継続)
- **`isNaN` → `Number.isNaN` への置換**: Codex 出力 `transport-orders.ts:541-555` の `expectMetricNumber` で `isNaN` を使用 (typecheck pass だが TypeScript 推奨は `Number.isNaN`)。次 Phase の機会に置換可

## Phase 45 入力契約

### 推奨される次 Phase スコープ
1. **§1.8 通知失敗・運用画面** (outbox 既存、手動再送 1 action のみ、最小縦切り)
2. **§1.5 詳細ページ `[id]`** (一覧から自然な遷移、副作用なし)
3. **§1.1 業務優先一覧テーブル** (spec §26 line 841 後段、`listTransportOrdersWithLatestInvitation` 再利用 + filter 拡張)
4. **§1.5 招待管理ビュー (revoke/再発行)** (副作用あり、admin-vendor-invitations 統合判断要)
5. **§1.4 店間整備依頼 admin UI** (大規模、service 先行)

### 参照すべきファイル
- 本 handoff (`phase-44-admin-dashboard-sealed.md`)
- `phase-43-transport-orders-ui-sealed.md` (前 Phase)
- `src/lib/services/transport-orders.ts:529-591` (getAdminDashboardMetrics + helper)
- `src/app/admin/dashboard/page.tsx` (Phase 44 全面書き換え 62 行、mirror パターン適用済)
- `src/app/admin/transport-orders/page.tsx` (Phase 43 縦切り mirror 元)
- `~/.claude/rules/common/codex-collaboration.md` §2.5 d (Phase 41 T1 ルール継続有効)

### 絶対に壊してはいけないもの (invariants)
- 既修正 12 bug すべてに retrogression なし
- typecheck clean / unit 35 PASS / integration 93 PASS
- CI E2E 7/7 PASS (Phase 45 で初 CI 確認時に維持)
- `admin_vendor_invitations.status` 遷移ルール (accepted→revoked 禁止)
- `revoked_at` column は schema に追加しない (Phase 42 確定)
- outbox は createAdminVendorInvitation / createTransportOrderWithNotification 時のみ作成
- `listTransportOrdersWithLatestInvitation` の戻り型 `TransportOrderListItem` 破壊禁止 (Phase 43 から継続)
- **`AdminDashboardMetrics` interface (`getAdminDashboardMetrics` 戻り型) を Phase 45+ で破壊変更しない** (dashboard/page.tsx と integration test が依存)
- **遅延案件の SQL 定義** (`vendor_response='pending' AND notification_sent_at < now() - interval '24 hours'`) を Phase 45+ で意味変更しない (テストが値依存)
- companyId はサーバー側 admin user から取得、URL/searchParams から取らない (tenant cross-leak 防止)

### 注意点・コンテキスト
- branch: `phase-42-t4-test-coverage` (Phase 43 commit `fa313e9` から +1 commit 予定)
- Phase 44 変更ファイル: 3 files / 215 insertions / 12 deletions
  - `src/lib/services/transport-orders.ts` (+64 lines)
  - `src/app/admin/dashboard/page.tsx` (-32 / +62, 全面置換)
  - `tests/integration/services/transport-orders.integration.test.ts` (+109 lines, import 追加 + describe block)
- Codex subagent 経路 default 化が定着、stdin hang 0 件 / 引き取り 0 件
- Phase 44 advisor 呼び出し 2 回 (scope 確認 / 実装方針確認)、両方とも「呼ばずに進めて良い」判定 — spec に答えがある場合の advisor 価値低下を確認
- `PostgreSQL COUNT(*)` は **bigint を返す**ため `expectMetricNumber` で number / string / bigint 全部受ける parser を実装済 (Phase 45+ で count 系 service 追加時の mirror 元)

## Codex ledger refs

- del-20260526-112817-6caa (service getAdminDashboardMetrics、applied)
- del-20260526-113139-c8d3 (page.tsx 全面書き換え、applied)
- (integration test 並列、上記 ledger entry に統合 or 別 ID — ledger 確認可)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 44 commit 数 | 1 (予定) |
| 変更ファイル | 3 M = 3 files (新規 0、純粋 modify) |
| 修正済 latent bug / 機能追加 | 1 (#12 §1.1 Dashboard 実データ化 — 累積 12) |
| advisor 呼び出し | 2 回 (両方とも「進めて良い」判定、spec/handoff に答えあり) |
| Codex 委任 task 数 | 3 (service / page / test) |
| Codex sandbox-blocked 率 | 0/3 (apply_patch 経路で安定) |
| Codex exec stdin hang | 0 件 (subagent 経路 default 化で回避) |
| Claude 側修正 (Codex 出力) | **0** (Phase 43 は 4 件、品質向上) |
| integration test 件数 | 91 → 93 (+2: dashboard metrics 2 件) |
| 新規 service 関数 | 1 (getAdminDashboardMetrics) |
| 新規 interface | 1 (AdminDashboardMetrics) |
| 新規 helper | 1 (expectMetricNumber) |

## 振り返りメモ

- **advisor 価値の境界**: Phase 43 では advisor が discriminating fact 抽出に有効だったが、Phase 44 では spec §26 line 841 に 3 指標明示済のため advisor が「呼ばずに進めて良い」と回答。`次回以降、handoff/spec で答えが特定済の Phase は advisor skip` のルールが立つ
- **Codex 出力品質向上の要因仮説**: Phase 43 → 44 で引き取り件数 4 → 0 件。差分は (1) prompt 内で既存パターンの **line 番号** を明示、(2) **invariant 列挙**、(3) **「推測 NG / 既存 test を読んで確認してから書く」明示**。Phase 45+ も同パターンを継続
- **Codex subagent 経路の default 化**: Phase 43 で stdin hang を発見、Phase 44 で 3/3 すべて subagent 経路にして hang 0 件。`codex exec 直接` は軽い相談のみ、実装委任は subagent 一択でルール化
- **`PostgreSQL COUNT(*)` bigint 問題への備え**: `expectMetricNumber` parser は Phase 45+ の count 系 service (例: §1.8 outbox failed count) で再利用可能。汎用 helper として `src/lib/services/_shared.ts` 等に切り出すか判断は Phase 45 で
- **新規 invariant 追加**: `AdminDashboardMetrics` interface + 遅延 SQL 定義を invariant 化。dashboard/page.tsx + integration test 両方が依存しているため、interface 変更は破壊的

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 44 完了、累積 12 機能追加 + §1.1 Dashboard 実データ化)*
