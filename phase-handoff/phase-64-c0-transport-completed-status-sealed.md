# Phase 64-C.0 transport `completed` status seed — sealed handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C.0 (業者ループ閉鎖の DB-layer 前提, α 必須 / MVP blocker #3) |
| 種別 | **implementation** (raw-migration)。adversarial gate 通過済み |
| Branch | `phase-64-mvp-implementation` |
| 前提 | A.34 sealed + CI green。transport_order TX 基盤 ready |
| 入力文脈 | `phase-handoff/phase-64-c-vendor-loop-closure-plan.md` (C 全体計画) |
| 次タスク | **C.1** (auto 確定 fix + L3-6 cancel→reservation 連動) |

## スコープ (このサブフェーズで完了したこと)

業者完了報告 (L2-12, C.3) が `transport_orders.status_id` を `accepted → completed` へ進めるための **DB-layer blocker** を解消した。現状 seed (0012/0015) は `requested/accepted/rejected/cancelled` の 4 status + 5 transition のみで `completed` が無く、`enforce_status_transition` trigger が遷移先不在で UPDATE を P0001 reject していた。

### 変更ファイル (5 件)

| ファイル | 内容 |
|---|---|
| `src/lib/db/raw-migrations/post/0028_seed_transport_completed_status.sql` (新規) | `seed_transport_statuses_for_company(uuid)` を CREATE OR REPLACE。`completed` status (display_order=25, is_terminal=true, name='Completed') + `accepted → completed` 遷移 (triggers_notification=true) を追加。既存 4+5 は ON CONFLICT DO NOTHING で維持。+ SECURITY DEFINER 関数の `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`。+ 全 company backfill DO ブロック |
| `spec/data-model.md` §15.6 | idempotency_key 2 行追記: `transport_order.completed` = `to:{id}:completed:v{version}` / `transport_order.store_confirmed` = `to:{id}:store_confirmed:v{version}` |
| `spec/requirements.md` §17.1 | transport / vendor status 一覧に実装追従注記 (案A 最小、フェーズ status は将来。A.25 spec drift 作法で一覧は残置) |
| `tests/_helpers/seed-transport-statuses.ts` | `SeededTransportStatuses` interface に `completed: string` 追加 (SELECT-only helper)。エラーメッセージに「post/0028 未適用」を追記 |
| `tests/integration/db/transport-status-completed-transition.integration.test.ts` (新規) | accepted→completed UPDATE 成功 + accepted→requested を P0001 reject (2 ケース) |

### 状態モデル (D1 = 案A 最小, 確定)

- coarse: `requested → accepted → completed` (+ 業者対応不可時 `rejected` / キャンセル時 `cancelled`)。
- 引取/搬入/返却の granular 進捗は `transport_orders.picked_up_at/delivered_at/returned_at` の timestamp 列で追跡 (status を増やさない)。
- 確定/未確定は `store_confirmed_at IS NULL` で判定 (新 status 不要)。
- spec §17.1 の「回送手配中/移動中/返却移動中」は MVP 非実装 (将来 additive)。

## plan からの evidence-based 逸脱 (3 件、advisor 承認済み)

1. **`triggers_notification` = `true` を維持** (plan の `false` を採らない)。
   - 経緯: plan は「cancel と同様 false」と記したが、0015 は cancel 含む全 transition を `true` で seed しており **事実誤認**。
   - 本列は spec/requirements.md §637 で「triggers_notification=true の遷移が outbox 行を生成する」と規定されるが **flag 駆動 dispatch は未配線** (enforce_status_transition は本列を読まず、outbox dispatcher は notification_outbox から直接 dequeue)。現状 dispatch に対し inert。
   - completed は cancel と同一バケット (どちらも service 層で明示 enqueue: completeAction / cancelTransportOrder)。completed だけ `false` にしても、cancel が `true` で残る以上、将来の flag 駆動 dispatch 実装時の監査作業を減らさず、現在の表示非一貫 + SECURITY DEFINER ブロック再構築 (既存 transition 破壊 surface 拡大) を機能差ゼロで招くだけ → `true` で揃える (最小 diff)。
2. **test の enforcement path = `transport_orders` UPDATE** (spec §15.5 が示唆する `*_status_history` INSERT ではない)。実装の trigger は `20_triggers.sql:255` で transport_orders の BEFORE UPDATE OF status_id に張られ、history INSERT には遷移検証 trigger が**存在しない** (history を対象にすると trigger を起動しない空テストになる)。
3. **§17.1 の所在 = `requirements.md`** (plan の「data-model.md §17.1」は file 取り違え。data-model.md §17 は migration 順序)。

## adversarial gate 結果 (raw-migration, spec/CLAUDE.md 発火条件 #1 該当)

### 発火条件チェック (具体的変更名を記載、checkbox theater 回避)

1. **raw-migration 変更あり**: `post/0028_seed_transport_completed_status.sql` (seed 関数 CREATE OR REPLACE + status/transition 追加 + REVOKE + backfill)。
2. 新規署名鍵/session: なし。
3. 手書き RLS/Storage policy: なし。
4. 金銭/billing: なし。
5. 新規 cross-tenant boundary: なし (既存 per-company seed パターンに合流)。**ただし既存の SECURITY DEFINER 関数の RPC surface を本 migration で是正 (下記 Codex WARN1)**。

### レビュー手段 (2 系統並走)

- **advisor 2 回 (着手前 + reconcile)**: triggers_notification の判断を最終確定 (`true` 維持)、REVOKE 適用方針確定。
- **dynamic workflow `wf_99f3cadb-ec2`** (5 frame find → adversarial verify): 確定 5 件すべて LOW。
- **Codex adversarial review (異モデル第二意見)**: WARN 2 件 + INFO 4 件。**Workflow が取りこぼした 2 WARN を Codex が捕捉** (異モデル併走の価値)。

### 対応した指摘

| 出所 | severity | 指摘 | 対応 |
|---|---|---|---|
| Codex WARN1 | WARN | seed 関数に `REVOKE EXECUTE FROM PUBLIC` 無し → 任意 target_company_id を渡せる SECURITY DEFINER RPC surface (0015 由来の既存 gap) | **0028 に REVOKE 追加**。grep で非 owner role からの `.rpc()` 呼び出し皆無を確認済 (trigger wrapper は definer 権限、backfill は owner ゆえ無影響)。20_triggers.sql:268 / 23:115 と同パターン |
| Codex WARN2 | WARN | `triggers_notification=true` が spec §637 / admin UI ラベルと矛盾 (dead でなく spec'd-but-unwired) | **コメント訂正 + 系統的 known-issue を documentation 化** (コード flip せず。理由: 上記逸脱1) |

### 対応不要と確定した指摘 (verify で LOW / refute / 既存課題)

| 出所 | 指摘 | 判断 |
|---|---|---|
| WF #3 | test の enforcement path 選択 (transport_orders UPDATE) | **正しいと確認**、変更不要 |
| WF #4 | audit AFTER UPDATE trigger が auth.uid()=NULL の CI で失敗しないか | **失敗しない** (actor_kind='system' fallback, actor_*_id nullable)、変更不要 |
| WF #5 | helper の `completed` 必須化が stale DB で 14 test 破壊 | CI は `supabase start` + `pnpm db:setup` を毎回実行ゆえ**安全**。local dev の friction のみ → helper エラーメッセージで緩和済 (severity 過大評価) |
| Codex INFO / WF #1,#2 | 冪等性 OK / per-company OK / 既存破壊なし | 確認済 |

## follow-up (別 phase, このサブフェーズ scope 外)

1. **reservation 版 seed の REVOKE gap**: `seed_reservation_statuses_for_company` (post/0023) も同じく `REVOKE EXECUTE FROM PUBLIC` が無い。同型の低 harm cross-tenant surface → 別 migration で revoke。
2. **triggers_notification 系統的監査**: §637 の flag 駆動 outbox dispatch を実装する際、explicit enqueue を持つ全 transition (cancel/completed/confirmed 系) の本 flag を service 層 enqueue と突合し、二重送信防止のため false へ揃える (既存行 UPDATE が必要)。
3. **`_raw_migrations` basename PK** (apply-raw-sql.ts): ディレクトリを含まないため将来 pre/alpha/post 間で同名衝突時に 2 回目 SKIP リスク。現在未発火 (0028 は post のみ)。相対パス化を別 phase で検討。
4. **0013 stale inline comment**: 0013 の trigger 関数は 0015 で wrapper に差し替え済だが inline 定義が残り誤読リスク。可読性のみ → 任意でコメント追記。

## 検証状態

- **ローカル**: `tsc --noEmit` 緑 / unit 79/79 緑 / prettier 緑。
- **integration test (本 migration の最終 gate)**: local Supabase 不可ゆえ **CI が gate** (A.34 precedent)。`.github/workflows/e2e.yml` が push 時に `supabase start` → `pnpm db:setup` (post/0028 適用) → `pnpm test:integration` (新テスト実行) を回す。
- 新テストは `DIRECT_URL` (CI は local Supabase) で `describeIntegration` が起動。

## invariants (壊していないことを確認済み)

- `24_vendor_rpcs.sql` は touch せず (L3-7 の confirmation_mode 分岐は C.1 以降で post-migration / TS service 層に追加)。
- 既存 4 status / 5 transition は ON CONFLICT DO NOTHING で不変。
- 通知は notification_outbox 経由 (本 migration は通知を発生させない。dispatch は C.2/C.3 service 層)。
- status 遷移は status_transitions seed 済みのみ (trigger 最終防衛線)。新遷移は seed 関数 + backfill で per-company 整合。
- A.21-A.34 invariants 全件維持。

## 次セッション (C.1) の最初の手順

1. 本 handoff + `phase-64-c-vendor-loop-closure-plan.md` を読む。
2. **C.1**: auto 確定 fix (L3-7 の auto 側 — accept 経路で confirmation_mode='auto' 時 `store_confirmed_at=now()` を同 TX セット) + L3-6 (cancelTransportOrder に reservation status 連動を追加)。
3. C.1 は低〜中判断量。reservation 連動は spec §確認要。
4. C.2/C.3/C.4 は C.0 後に並列性あり (C.3 UI は Codex 委任候補)。

*Phase 64-C.0 sealed / Generated by Claude 2026-05-30 / adversarial gate (advisor×2 + workflow wf_99f3cadb-ec2 + Codex) 通過 / triggers_notification=true 維持・REVOKE 追加・test=UPDATE path / 次: C.1*
