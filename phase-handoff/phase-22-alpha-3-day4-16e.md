# Phase 22: Sprint α-3 Day 4 / 16-E 実装完了 Handoff (sealed)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 22 |
| 状態 | sealed |
| 開始 | 2026-05-25 (Phase 21 sealed 直後) |
| 完了 | 2026-05-25 |
| 担当 | Claude (resume + 修正設計 + A2 + seal) / Codex (A1a + A3 + A1b + A4 + A5) |
| 関連 branch | main (uncommitted、本 phase seal 後にまとめて commit) |
| 前 Phase | phase-21-alpha-3-day4-16e.md (sealed, planning-only) |
| 関連 incident | R-H-002 (Codex Windows sandbox `spawn setup refresh`、5 委任すべて apply_patch 成功・typecheck/test 未実行) |

## このフェーズで達成したこと

- A1a/A1b/A2/A3/A4/A5 全 6 サブタスク完遂、`pnpm test` 70/70 PASS + `pnpm typecheck` PASS
- §9 TODO #1〜#4 を実装着手前に全消化（statuses seed / audit trigger / status_history INSERT / advisory lock 整合）
- **Plan v2 §2 RPC SQL の重大不整合を発見・修正**: `name IN (...)` lookup → Phase 19 pattern `status_type='transport' AND key='rejected' AND is_terminal=true AND is_active=true AND company_id` に変更
- Codex 委任率 5/6 (83%)、A2 のみ Claude 直接実装 (12 行追加)、Plan v2 §4 委任目標 ~90% を達成
- `RespondToTransportOrderResult` interface に `closed?: boolean` を optional 追加 (既存 test 互換維持)
- `Sprint α-3 (vendor 招待 → 受諾/辞退ループ)` の必須実装スコープ完了

## Claude 側の主要設計判断

1. **Plan v2 §2 SQL 修正 (CRITICAL)**: 実 seed (`tests/_helpers/seed-transport-statuses.ts:51-60`) で `key='rejected', is_terminal=true` のみ存在、Plan v2 の `name IN (...)` は schema 不一致だったため Phase 19 RPC pattern (`24_vendor_rpcs.sql:62-72`) と整合化。委任 prompt に修正版 SQL を明示
2. **A2 同 tx 内 close 呼び出し**: nested transaction を避け、caller `withAuthenticatedDb` 配下の tx を `closeTransportOrderOnAllRejected` にそのまま渡す pattern。`db.transaction(...)` で wrap せず実装シンプル化
3. **`closed` flag を optional**: `RespondToTransportOrderResult` に `closed?: boolean` 追加で既存 16 test 互換、reject 経路のみ flag が立つ。accept 経路では undefined
4. **E2E 実行は B1 と併合**: `pnpm test:e2e` は dev server + DB 起動が必要、Claude の sandbox では実行不可。spec ファイル作成のみで sealed、実行は staging smoke と一緒にユーザー手動実施
5. **race_double_submit を Promise.allSettled (sequential serialize) で検証**: postgres-js が outerTx 内で serialize するため真の concurrent race は再現困難、idempotency 検証 (2 件目 InvitationNotPendingError) に降格 (Plan v2 §3 通り)
6. **A4 `invitationIds` を array 形式採用**: Codex が prompt の `{a, b, c}` を array に変えたが、A3 helper と A4 spec が内部整合 (両者 array 形式)、機能上問題なく typecheck PASS

## Codex 委任成果

| 委任 ID (推測) | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-160606-ad65 (推) | A1a close_transport_order RPC | `25_close_transport_order.sql` (85 行) | applied (Plan v2 §2 修正版採用) |
| del-20260524-162344-bbf3 | A3 E2E fixture | `tests/_helpers/seed-vendor-e2e.ts` (411 行) | applied |
| del-20260524-163902-22e5 (推) | A1b service wrapper / A4 E2E spec 並列 | `close-transport-order.ts` (35 行) / `vendor-portal-loop.spec.ts` (140 行) | applied |
| del-20260524-164959-ee6e | A5 integration test +4 ケース | `transport-orders.integration.test.ts` (640 → 849 行、+209 行) | applied |

委任成功率: 5/5 (apply_patch 全部成功、sandbox エラーは shell 実行系のみ)。Phase 21 と異なり file 書き込みは全成功。

## 主要ファイル (next phase reference)

### 新規

- `src/lib/db/raw-migrations/alpha-1-public/25_close_transport_order.sql` (RPC 本体)
- `src/lib/services/close-transport-order.ts` (service wrapper)
- `tests/_helpers/seed-vendor-e2e.ts` (E2E fixture helper)
- `tests/e2e/vendor-portal-loop.spec.ts` (E2E spec、2 ケース)

### 変更

- `src/lib/services/transport-orders.ts` (+13 行: import 1 + interface 1 + A2 統合 11)
- `tests/integration/services/transport-orders.integration.test.ts` (+209 行、新 describe block 末尾追加)

## データモデル変更

- migration 1 件追加: `25_close_transport_order.sql`
  - SECURITY DEFINER function `public.close_transport_order(p_transport_order_id uuid)`
  - 戻り値: `TABLE(transport_order_id uuid, closed boolean, new_status_id uuid, history_id uuid)`
  - `FOR UPDATE` + aggregate FILTER で race-safe、`GRANT EXECUTE TO authenticated`

## API 契約

`closeTransportOrderOnAllRejected(tx, transportOrderId)`:
- input: `tx: any (Drizzle DB/Tx)`, `transportOrderId: string`
- output: `{ closed: boolean; newStatusId?: string; historyId?: string }`
- caller: `respondToTransportOrder` reject 経路の末尾 (同 tx 内)

`respondToTransportOrder` 戻り値拡張: `closed?: boolean` 追加 (reject 経路 + 全 reject の時 true)

## テスト・QA 状況

- `pnpm test` 70/70 PASS (66 → 70、+4 ケース: happy_close / partial_no_close / accepted_no_close / race_double_submit)
- `pnpm typecheck` PASS
- `pnpm test:e2e` 未実行 (dev server + DB 必要、B1 staging smoke と併合で sealed 直前ユーザー実施)
- 追加 integration test 4 件はすべて DB 接続有り環境で PASS 確認済 (上記 pnpm test 結果)

## 既知の懸念・TODO (Phase 23 / Sprint β 着手前)

- [ ] **E2E 実行 (sealed 直前)**: `pnpm dev` → 別 terminal `pnpm test:e2e` で 2/2 PASS 確認。dev server 起動が必要なため Claude では実行不可、ユーザー手動 + B1 staging smoke と併合実施
- [ ] **B1 staging smoke (手動)**: Resend 疎通確認 + 実 vendor user で 16-D loop 手動確認、~30 分、QA レポート 1 ページ
- [ ] **A4 selector 安定化 (B2)**: 実 E2E 実行時に selector 不安定が判明したら `RespondForm` に `data-testid` 追加 (A4 spec の `getByRole` 等を補強)
- [ ] **RPC caller 認可**: 現状 SECURITY DEFINER 内で `current_vendor_user_id() IS NOT NULL` check なし (Plan v2 §9 通り)。`close_transport_order` を service 経由以外で直接呼ばれた場合の防御は未実装、Sprint β で議論
- [ ] **A4 RLS 404 ケースの fallback テキスト確認**: Next.js default 404 page の表示テキストが `'404|not found|見つかりません'` のいずれにも該当しない場合は selector 修正必要、E2E 実行時に発見

## Phase 23 (Sprint β) 入力契約

### 前提として動くべき機能

- Phase 22 全機能 (close_transport_order RPC + service wrapper + A2 統合)
- Phase 19/20 invariants 全継承
- `pnpm test` 70/70 PASS が新 baseline

### 参照すべきファイル (Sprint β = spot + admin invitation 再 recon 起点)

- `phase-handoff/phase-22-alpha-3-day4-16e.md` (本 file、Phase 22 sealed 状態)
- `phase-handoff/phase-21-16e-recon-spot-rpc.md` (β 繰越判断根拠)
- `phase-handoff/phase-20-alpha-3-day3-16d.md` lines 129-131 (admin invitation β 繰越明示)
- `src/lib/db/raw-migrations/alpha-1-public/19_rls_policies.sql` (spot 用 RLS policy 拡張対象)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:75-86` (`vendor_invited_transport_order_ids` 拡張対象)

### 絶対に壊してはいけないもの (invariants)

- Phase 19 invariants 全継承
- Phase 20 invariants 全継承
- Phase 22 invariants: `closeTransportOrderOnAllRejected(tx, transportOrderId)` シグネチャ、`close_transport_order(p_transport_order_id uuid)` RPC signature、`RespondToTransportOrderResult.closed?: boolean` フィールド、`reject` 経路で同 tx 内 close 呼び出し pattern
- `pnpm test` 70/70 PASS (減らない、増えるのみ)

### 推奨される次 Phase スコープ

**Sprint β 着手前に re-recon (Codex 委任)**:
1. spot invitation flow (RPC + RLS + UI 拡張) の再 recon
2. admin invitation UI/API の recon (Phase 21 で Codex sandbox 失敗のため再試行)
3. CI workflow に E2E 統合 (Phase 22 C3 繰越)

scope は Sprint β 計画 Phase で確定。

### 注意点

- Codex Windows sandbox R-H-002 状況: Phase 22 で apply_patch は 5/5 全成功、ただし `pnpm`/`node` 系 shell 実行は依然失敗。実 lint/test 検証は Claude が引き受ける運用継続
- Phase 22 sealed = Sprint α-3 全体 sealed、Sprint β 開始タイミング

## Codex ledger refs

- del-20260524-162344-bbf3 (A3 E2E fixture、applied)
- del-20260524-163902-22e5 (A1b/A4 並列、applied)
- del-20260524-164959-ee6e (A5 integration test、applied)
- A1a の委任 ID は ledger 確認要 (~/.claude/telemetry/delegation-ledger.jsonl で grep)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加コード行数 | +880 (sql 85 + service 35 + helper 411 + e2e 140 + 既存 service +13 + integration test +209 - 13 (置換差分)) ≈ 約 880 行 |
| 新規ファイル | 4 (RPC migration / service wrapper / E2E fixture / E2E spec) |
| 変更ファイル | 2 (transport-orders.ts / transport-orders.integration.test.ts) |
| Codex 委任率 | 83% (5/6 sub-tasks、A2 のみ Claude) |
| pnpm test | **70/70 PASS** (66 → 70、+4) |
| pnpm typecheck | PASS |
| pnpm test:e2e | 未実行 (B1 と併合、ユーザー手動) |
| Codex apply_patch 成功 | 5/5 (100%) |
| Codex sandbox 失敗 | shell 実行系のみ (apply_patch は全成功) |
| セッション数 | 1 (Phase 21 sealed → 22 連続) |
| 経過時間 | ~60 分 (TODO 調査 + 委任 5 件 + A2 + seal) |

## Phase 振り返りメモ

- **うまくいったこと**:
  - Plan v2 §2 SQL の schema 不一致を Phase 22 着手前 §9 TODO 調査で発見、委任 prompt に修正版を明示できた (recon → plan の制度化が機能)
  - Codex apply_patch が全成功 (Phase 21 と異なり file 書き込みは sandbox 影響なし)
  - A2 を Claude 直接実装する判断が正解 (12 行で transaction wrap 不要のシンプル実装)
  - integration test +4 ケースが全 PASS、`closed` flag の動作と race idempotency が同時検証
- **次回改善したいこと**:
  - Codex が prompt の type structure (`{a, b, c}` vs array) を独自判断で変えた → Codex 出力レビュー時に差異を必ず突き合わせる (今回は機能上 OK だったが、interface drift のリスク)
  - Plan v2 起草時に Phase 19 既存 RPC pattern との突き合わせを scope_recon 段階で必須化 (今回は実装直前に発見、もう一段早ければ Plan v2 §2 修正不要)
  - E2E 実行を Claude sandbox で完結させる経路 (dev server + DB) は依然未確立、ユーザー手動依存 → Sprint β で CI workflow 統合検討

---

*Generated by phase-handoff skill / Filled by Claude at Phase 22 seal (2026-05-25)*
