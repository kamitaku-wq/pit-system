# Phase 55 入力契約: Phase 54 SQL 関数共通化 sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 54 (前: 53 sealed) |
| 状態 | **sealed** (typecheck clean / 17 test files / 152 tests PASS / db:apply-raw:post 0015 適用済) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + SQL 自実装 + commit + seal、軽微) |
| 前 handoff | `phase-53-change-logs-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 53 `de010b1` から +1, HEAD `e9725fb`) |

## 達成したこと (Phase 54)

- **drift surface 削減** (Phase 51 sealed 残課題): 3 → 2 (0012 + 0015)
  - 新規 SQL function `public.seed_transport_statuses_for_company(target_company_id uuid)` を `post/0015_seed_transport_statuses_function.sql` で追加
  - status 4 件 + transitions 5 件を ON CONFLICT DO NOTHING で INSERT、SECURITY DEFINER + search_path 固定 (Phase 51 pattern 踏襲)
- **Phase 51 trigger function を refactor**: `seed_transport_statuses_on_company_insert()` を CREATE OR REPLACE で新関数経由 (PERFORM ラッパー) に置換、trigger object 自体は維持
- **0012 historical artifact 化**: 既存 backfill SQL は apply-raw-sql.ts SKIP で不変、新規 deploy も同 INSERT pattern で動作、結果は新 function と同等 (冪等)
- **Codex 委任 0 件**: scope 極軽微、Claude 自実装 (Phase 50 SQL 教訓継続)
- **adversarial review なし**: 機能等価 refactor (副作用 0)、Phase 48-49 同基準

## Claude 側の主要設計判断

1. **trigger refactor は CREATE OR REPLACE FUNCTION**: trigger object (`trg_seed_transport_statuses_on_company_insert`) 自体は維持、内部 plpgsql のみ置換 = 機能等価
2. **0012 を改変しない**: 過去 migration の改変は破壊的、historical artifact として保持。新規 deploy では古い直接 INSERT pattern で走るが ON CONFLICT で冪等、結果同じ
3. **共通 function 1 箇所 = source of truth**: 将来値変更は 0015 function 修正のみで完結 (drift 構造解消)
4. **adversarial review skip**: 機能等価 refactor で副作用 0 / migration syntax 単純 / 既存 trigger 動作 test で確認可
5. **Codex 委任なし**: SQL 50 行で hook 通過可、Phase 50 教訓「schema-specific は Claude 自実装」継続

## Codex 委任成果

委任 0 件。本 Phase は SQL 50 行のみで Codex 介入不要。

**Codex 出力品質**: Phase 43→44→45→46→47→48→49→50→51→52→53→54 で 0→0→0→0→1→2→0→0→2→0→0→0→**N/A** (委任 0)。

## Phase 41-54 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-15 | Phase 31-A〜46 | 39-46 | (前 sealed.md 参照) |
| 16 | cancel action 不在 | 47 | §1.5 cancel action |
| 17 | Phase 47 持ち越し | 47 | Number.isNaN |
| 18 | Phase 46 持ち越し | 48 | §1.5 store name 表示 |
| 19 | Phase 44 持ち越し | 49 | §1.1 業務優先一覧 |
| 20 | Phase 16-E skip | 50 | backfill migration |
| 21 | Phase 50 持ち越し | 51 | companies INSERT trigger |
| 22 | Phase 51 横展開漏れ | 52 | seed-admin-e2e.ts cleanup |
| 23 | Phase 16 以降 spec §7.8 未整合 | 53 | change_logs schema 整合 |
| **24** | Phase 51 sealed drift 課題 | **54** | SQL 関数共通化 (drift 3 → 2) |

## 残課題 / Phase 55 todo

### MVP blocker

- **#1**: 解消済 ✓ (Phase 50 + 51)
- **#2**: reservation cancel 遷移 (wake-up 領域)
- **#3**: Worker handler (wake-up 領域)
- **#4**: 解消済 ✓ (Phase 53 schema 整合、service 統合は別 task)

### Phase 55 推奨スコープ候補

1. **`transport_order_change_logs` service 統合** (Phase 53 schema 完了、cancelTransportOrder で change_type='cancelled' + before_json/after_json 記録、redaction policy 検討、副作用あり要 adversarial review)
2. 他 status_type (reservation/service/vendor) の trigger seed 横展開 (Phase 51 pattern 流用、各 status_type の test 整備必要)
3. 0012 を `seed_transport_statuses_for_company` 経由に書き換え (drift surface 2 → 1、ただし過去 migration 改変で破壊的、慎重に判断)
4. MVP blocker #2 #3 (両方 wake-up 領域)
5. 一般 todo (Phase 47-52 sealed 継続)

### 一般 todo

(Phase 47-53 sealed 参照、変化なし)

## Phase 55 入力契約

### 参照すべきファイル

- 本 handoff (`phase-54-sql-function-sealed.md`)
- `phase-53-change-logs-sealed.md`
- `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` (historical artifact)
- `src/lib/db/raw-migrations/post/0013_companies_insert_trigger_status_seed.sql` (trigger 定義、内部実装は Phase 54 で refactor 済)
- `src/lib/db/raw-migrations/post/0015_seed_transport_statuses_function.sql` (Phase 54 新規)
- `src/lib/db/schema/transport_order_change_logs.ts` (Phase 53 schema、Phase 55 で service 統合候補)

### 絶対に壊してはいけないもの (invariants)

- 既修正 24 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 152 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-53 確定)
- **Phase 54 function semantic 維持**: `seed_transport_statuses_for_company(uuid)` の status 4 件 + transitions 5 件 + ON CONFLICT pattern は変更禁止 (source of truth)
- **trigger object 名維持**: `trg_seed_transport_statuses_on_company_insert` は Phase 51 確定、Phase 54 refactor 後も維持
- **drift surface 2 (0012 + 0015) 認識**: 値変更時は 0015 function 修正のみで OK、0012 は historical artifact

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 54 commit `e9725fb`、Phase 53 `de010b1` から +1)
- Phase 54 変更ファイル: 1 new = 1 file
- Codex 委任 0 件、advisor 呼び出し 0 件
- 本番 deploy 時に 0015 を適用 (`pnpm db:apply-raw:post`)、新規 company INSERT 時に新関数経由で seed されることを Phase 50 docs post-check SQL で検証

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 54 commit 数 | 1 (`e9725fb`、本 sealed +1 予定) |
| 変更ファイル | 1 new = 1 file |
| 修正済 latent bug / 機能追加 | 1 (#24 SQL 関数共通化 — 累積 24) |
| advisor 呼び出し | 0 |
| Codex 委任 task 数 | 0 |
| Claude 側修正 | 1 (SQL 50 行、Claude 自実装) |
| test files | 17 (変化なし) |
| integration + unit test 件数 | 152 (変化なし) |
| 新規 migration | 1 (`0015_`) |
| 新規 SQL function | 1 (`seed_transport_statuses_for_company`) |
| MVP blocker 解消 | 0 (Phase 54 は drift 解消、blocker 直接解消なし) |

## 振り返りメモ

- **scope 極軽微 Phase の効率化が定着**: Phase 52 (5 行) → Phase 54 (50 行) で advisor 不要・Codex 不要・plan 省略の流れが安定。Phase 47-51 で確立した規律をベースに、軽微 Phase はスピード優先
- **drift 構造解消の達成**: Phase 49 sealed で「formatDateTime 3 箇所目で共通化」と書いた pattern を Phase 54 で SQL に適用。3 → 2 削減 (完全 1 化は 0012 改変が必要で OUT)
- **CREATE OR REPLACE FUNCTION の機能等価 refactor**: trigger object 維持で internal implementation のみ置換、production 影響なしで refactor 可能。今後の trigger refactor pattern として確立
- **連続 8 Phase 完走 (48-54)**: wake-up 領域を回避しつつ Phase 48 (UI) → 49 (UI) → 50 (DB backfill) → 51 (trigger) → 52 (cleanup) → 53 (schema 整合) → 54 (function 共通化)、計 8 features 追加 (#18-#24 = 7 + #17 含む = 8)

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 54 完了、累積 24 機能追加 + SQL 関数共通化、drift 3 → 2 削減)*
