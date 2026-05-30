# Phase 62 入力契約: Phase 61 transport_orders.store_confirmed_by_user_id 複合 FK sealed (D5 解消)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 61 (前: 60 sealed) |
| 状態 | **sealed** (typecheck clean / 23 test files / 188 tests PASS / drift 2→2) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope pivot + plan v1 + advisor + pre-check + seal) + Codex (implementation 委任 1 件、scope 外 modify 1 件あり Claude 復元) |
| 前 handoff | `phase-60-admin-vendor-invitations-fk-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 60 から +1 commit 予定: feat + 本 seal) |

## 達成したこと (Phase 61)

- **debt 台帳 D5 解消**: `transport_orders.store_confirmed_by_user_id` の company 整合を schema 強制 (本番主要 active table 初の D phase)
  - 複合 FK `(store_confirmed_by_user_id, company_id) → users(id, company_id)` 追加 (MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT)
  - 既存単独 FK を catalog query で動的特定 → DROP
  - `users_id_company_id_unique` 冪等 check (Phase 56 で追加済)
- **scope pivot 透明性確保**: ユーザー指示「推奨で進める」を Phase 60 §推奨 #1 「D5+ 確認」として精査 → C (change_type 拡張) は 4 種 service 全未実装の wake-up 領域と判明 → A-narrow (D5 preventive) に pivot、advisor 提案を採用
- **pre-check empirical 反映** (advisor 指摘 1): `store_confirmed_by_user_id IS NOT NULL` = 0 verified、transport_orders trigger 3 件確認 (`trg_audit_transport_orders` / `trg_enforce_status_transition` / `trg_set_updated_at`)
- **audit trigger side-effect 明示** (advisor 指摘 2): Phase 60 D4 pattern 流用、観点 2 UPDATE 成功時に `audit_logs` row 生成は expected side-effect として記述、regression と分離
- **IF MATCH future SET pattern test 採用** (advisor 指摘 3): 観点 2 で ADR-0007 IF MATCH (version) の future `confirmTransportOrderManually` service write pattern を mirror、`version` increment + `store_confirmed_at` 同時 SET も assert
- **Codex adversarial review skip 判断** (advisor Meta-note): 5 回目同型 repetition + pre-check clean のため marginal value 低下、Codex 委任 quota を implementation 側に振る
- **5 観点 integration test 追加** (UPDATE-based 文脈、D2 INSERT-based の置換): cross-company / same-company IF MATCH / NULL / RESTRICT delete / statement-time
- **Codex 委任 1 件**: implementation 一括 (migration + schema + test 新規)、apply_patch sandbox-blocked → Claude 経由 Write/Edit + Node.js fallback で bypass、典型 D2 pattern 流用で 1 発採用 (semantically 正しい)
- **drift 維持**: 0021 ALTER のみで drift 2 → 2 (`Everything's fine 🐶🔥`)

## Claude 側の主要設計判断

1. **scope pivot C → A-narrow**: Phase 60 §推奨 #1「D5+」精査で 4 種 change_type 全未実装の wake-up 領域判明 → advisor 提案で A-narrow へ。Phase 56-60 pattern 連続性維持
2. **Codex adversarial review skip 判断**: 5 回目同型 + pre-check clean (data=0 / audit trigger 既知) → review marginal value 低下、Codex 委任 quota を implementation に振る。ユーザー時間温存
3. **D2 pattern 完全流用 + D5 固有調整**: Phase 58 (`reservation_status_history`) preventive hardening pattern を transport_orders に置換、本番 active main table 初の D phase という新 precedent を 1 statement CTE pattern + UPDATE 文脈 + IF MATCH (version) future pattern + audit trigger side-effect 明示で構造化
4. **observable side-effect 切り分け**: `trg_audit_transport_orders` UPDATE 時 audit_logs 生成、`trg_enforce_status_transition` は status_id 変更時のみ発火 (本 phase 範囲外)、`trg_set_updated_at` は副次。test invariant に影響なし
5. **scope 外 destructive change 即座復元**: Codex implementation で Phase 59 D3 test (`tests/integration/db/transport-order-invitations-fk.integration.test.ts`) が 439 行 → `// test placeholder` の単一行に上書きされた critical bug を git status で検出 → `git checkout HEAD --` で復元、Phase 59 D3 7 観点維持

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| `a0faa72f82cb40531` (implementation) | migration + schema + new test 一括 (apply_patch sandbox-blocked → Write/Edit/printf fallback) | applied 3 files / typecheck clean / new 5/5 PASS / 全体 188/188 PASS / drift 2→2 / **scope 外 modify 1 件 (Phase 59 D3 test 全削除) を Claude 即時復元** |

**Codex 出力品質**: Phase 43→...→55→56→57→58→59→60→**61** で 0→0→...→0→3→3→2→2+1→**1 (但し scope 外 destructive modify 1 件、復元必須)**。Phase 60 まで 4 連続 1 発採用ストリーク (semantics は正しかった)、Phase 61 で**ストリーク破断** (scope 外 destructive 検出によりカウントせず)。implementation semantics は正しく、scope-cleanliness が新たな考慮点として浮上。Phase 62+ では Codex プロンプトに「scope 外ファイル変更禁止」明示を強化推奨。

## Phase 41-61 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-30 | Phase 31-A〜60 | 39-60 | (前 sealed.md 参照) |
| **31** | Phase 60 sealed §推奨 #1 (D5+ 精査) → advisor pivot | **61** | `transport_orders.store_confirmed_by_user_id` 複合 FK で company 整合 schema 強制 (本番主要 active table 初の D phase、preventive hardening) |

## 残課題 / Phase 62 todo

### MVP blocker

- #1: 解消済 ✓ (Phase 50+51)
- #2: reservation cancel 遷移 (wake-up 領域)
- #3: Worker handler (wake-up 領域)
- #4: 解消済 ✓ (Phase 53+55)

### Phase 62 推奨スコープ候補

1. **debt 台帳 D6 候補**: `attachments.uploaded_by_user_id` (規模軽微、active 経路 0、Phase 58 D2 pattern preventive で確認) — 同 pattern 6 回目になるため marginal 警戒
2. **debt 台帳 D7 候補**: `vendor_selection_logs.selected_by_user_id` (ADR-0008 関連、active 経路 0、同 pattern preventive)
3. **Phase 60 BLOCK-2 緩和 TODO**: `createAdminVendorInvitation` direct call 化 + supabase auth.admin complete mock 整備 (Phase 60 で明示 TODO 化)
4. **drift 2 → 1 (0012 書き換え)** (Phase 54 sealed §残課題): 破壊的、慎重判断
5. **MVP blocker #2 #3** (wake-up 領域)
6. **transport_order.changed outbox worker 実装** (wake-up 領域)
7. **redaction policy 拡張** (`redact_transport_order_payload` 関数追加) — change_type 拡張依存で着手前提薄い
8. **reservation feature 実装着手** (Phase 58 で復活する `trg_reservation_transition` + reservation status seed function 追加)
9. **cancel test seedFixture 謎調査** (Phase 56 sealed §残課題、Phase 57-61 未着手)
10. **change_type 拡張 (本格 service 実装込み)**: vendor_changed / datetime_changed / rejected_reassigned / recreated 4 種、Phase 55 cancel pattern + Phase 56 FK 強制活用、wake-up 領域

### 一般 todo

(Phase 47-60 sealed 参照、変化なし)

## Phase 62 入力契約

### 参照すべきファイル

- 本 handoff (`phase-61-store-confirmed-by-user-fk-sealed.md`)
- `phase-60-admin-vendor-invitations-fk-sealed.md` (D4 元 pattern)
- `phase-58-reservation-status-history-fk-sealed.md` (D2 元 pattern、preventive base)
- `phase-57-status-history-fk-sealed.md` (D1 元 pattern、active 経路あり)
- `phase-61-store-confirmed-by-user-fk-plan.md` (v1 採用版、advisor 指摘 3 + Meta-note 全採用)
- `src/lib/db/raw-migrations/post/0021_transport_orders_store_confirmed_by_user_company_composite_fk.sql` (D5 migration)
- `src/lib/db/schema/transport_orders.ts` (D5 schema)
- `tests/integration/db/transport-orders-store-confirmed-by-user-fk.integration.test.ts` (5 観点 / 1 statement CTE / UPDATE 文脈 / IF MATCH future SET pattern)
- spec/data-model.md §7.6 (transport_orders)、§17 (migration 順序)、§A.7 (`store_confirmed_at` 関連)
- spec/requirements.md L581-582 (`auto` / `manual` confirmation_mode、`store_confirmed_by_user_id` future use case)

### 絶対に壊してはいけないもの (invariants)

- 既修正 31 bug/機能すべてに retrogression なし
- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-60 確定)
- **Phase 61 複合 FK semantic 維持**: `(store_confirmed_by_user_id, company_id) → users(id, company_id)`, MATCH SIMPLE, ON DELETE NO ACTION, ON UPDATE RESTRICT
- **users(id, company_id) UNIQUE 維持** (Phase 56 で追加、Phase 57-61 で再利用)
- **transport_orders active 経路の `store_confirmed_by_user_id` 不変 invariant**: createTransportOrder / cancelTransportOrder / RPC 経由 status update / vendor accept など既存経路は `store_confirmed_by_user_id` を SET しない (default NULL のまま) → MATCH SIMPLE で FK check skip
- **Phase 59 D3 test integrity 維持**: `tests/integration/db/transport-order-invitations-fk.integration.test.ts` 7 観点 (439 行) を絶対に上書き削除しない (Phase 61 で Codex に scope 外 destructive modify されかけた、復元済)
- **audit trigger side-effect 期待**: `trg_audit_transport_orders` UPDATE 時 `audit_logs` row 生成は expected (Phase 60 D4 pattern 継承)
- **drizzle-kit generate/push 禁止**: raw migration 0016-0021 が authoritative
- **catalog query 冪等性 pattern 維持**: D6+ でも DO ブロック + `IF NOT EXISTS` / `IF EXISTS` + FOR LOOP DROP pattern 踏襲
- **1 statement CTE pattern 維持** (Phase 60 確立): 新規 integration test の user INSERT は `WITH auth_user AS (INSERT INTO auth.users ...) INSERT INTO public.users SELECT id ...` 必須
- **Drizzle `onDelete` omit pattern 維持** (Phase 58 BLOCK-3 確立、Phase 59-61 継承)

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 61 から、seal commit + feat commit で +2 予定)
- Phase 61 変更ファイル: 1 new (migration) + 1 modify (schema) + 1 new (test) + 2 plan/seal = 5 files
- Codex 委任 1 件 (implementation のみ、adversarial review skip)、advisor 呼び出し 2 件 (scope pivot 確認 + plan v1 approach 確認)
- **Codex scope 外 destructive modify 教訓**: Phase 61 implementation で Phase 59 D3 test 439 行が `// test placeholder` 1 行に上書きされた。`git status` で検出 → `git checkout HEAD --` で即復元。Phase 62+ では Codex プロンプトに「scope 外ファイル変更禁止」明示推奨、`git status` を委任後必ず確認
- Codex sandbox-blocked → Write/Edit/printf fallback で bypass 成功 (Phase 60 で確立した pattern を継承)
- D6 候補 (attachments) は同 pattern **6 回目** で marginal 警戒、Phase 62 着手前に value 評価推奨
- Phase 60 BLOCK-2 緩和 TODO は依然未消化、change_type 拡張前提に依存

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 61 commit 数 | 2 予定 (feat + 本 seal commit) |
| 変更ファイル | 1 new (migration) + 1 modify (schema) + 1 new (test) + 2 plan/seal = 5 files (前 phase 6 から減、review skip 反映) |
| 修正済 latent bug / 機能追加 | 1 (#31 transport_orders.store_confirmed_by_user_id 複合 FK — 累積 31) |
| advisor 呼び出し | 2 (scope pivot 確認 + plan v1 approach 確認) |
| Codex 委任 task 数 | 1 (implementation のみ、adversarial review skip) |
| Codex sandbox-blocked | 1/1 → Write/Edit/printf fallback で bypass 成功 |
| Claude 側修正 (Codex 出力) | **1 件 (scope 外 destructive modify 復元のみ、semantics 修正は 0)** |
| Codex 出力 1 発採用ストリーク | Phase 55+57+58+59 = 4 → Phase 60 で advisor fix 1 件 → Phase 61 で **scope 外 destructive 検出によりストリーク破断**。semantics 正確性は維持 (Phase 60+61 で再カウント開始可) |
| test files | 23 (Phase 60 22 → +1) |
| integration + unit test 件数 | 188 (Phase 60 183 → +5) |
| 新規 test assertion | +5 (cross-company / same-company IF MATCH / NULL revert / RESTRICT delete / statement-time) |
| 新規 migration | 1 (`0021_transport_orders_store_confirmed_by_user_company_composite_fk.sql`) |
| 新規 SQL function | 0 |
| MVP blocker 解消 | 0 (preventive hardening) |
| drift | 2 → 2 (増加なし) |

## 振り返りメモ

- **scope pivot の透明性**: 「推奨で進める」を Phase 60 §推奨 #1 として精査 → C wake-up 領域判明 → A-narrow へ pivot を ledger に明示。ユーザー指示の射程を advisor 助言で confirm
- **Codex adversarial review skip 判断の合理性**: 5 回目同型 + pre-check clean で marginal value 低下、Codex quota を implementation に振った。implementation で sandbox-blocked + scope 外 destructive が両方発生、review skip は判断としては合理だが「review が catch する可能性のあった scope 外 modify」が implementation で表出した点は教訓
- **D 系 active main table 初の precedent**: Phase 56-60 までは aux table (status_history / change_logs / invitations) 限定、Phase 61 で transport_orders 本体に到達。UPDATE-based test 文脈 + audit trigger side-effect + IF MATCH (version) future pattern の 3 観点が新規確立
- **Codex scope 外 destructive modify は新たな failure mode**: Phase 60 まで sandbox-blocked / advisor 指摘の 2 failure mode が確立されていた。Phase 61 で 3 つ目の「scope 外 destructive modify」mode が表出。`git status` 確認を委任後必須 protocol 化、プロンプトに「scope 外ファイル変更禁止」明示推奨
- **連続 15 Phase 完走 (47-61)**: wake-up 領域回避しつつ 15 features (#17-#31) 追加。Phase 62 は debt 台帳 D6 候補 (attachments) の value 評価 or BLOCK-2 緩和 TODO or wake-up 領域への移行を検討

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 61 完了、累積 31 機能追加 + transport_orders 本体初の D phase、debt 台帳 D5 解消、advisor pivot + Codex review skip + scope 外 destructive 復元の 3 つの新規 precedent 確立)*
