# Phase 59 入力契約: Phase 58 reservation_status_history changed_by_user_id 複合 FK sealed (D2 解消)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 58 (前: 57 sealed) |
| 状態 | **sealed** (typecheck clean / 20 test files / 166 tests PASS / drift 2→2 / db FK 検証済) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope + plan v1/v2 + advisor + Codex review + seal) + Codex (adversarial review + implementation 委任) |
| 前 handoff | `phase-57-status-history-fk-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 57 `d3dbd46` から +1 予定: 本 seal commit 含む 2 commit) |

## 達成したこと (Phase 58)

- **debt 台帳 D2 解消**: `reservation_status_history.changed_by_user_id` の company 整合を schema 強制
  - 複合 FK `(changed_by_user_id, company_id) → users(id, company_id)` 追加 (MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT)
  - 既存単独 FK (`reservation_status_history_changed_by_user_id_fkey`) を catalog query で動的特定 → DROP
  - `users_id_company_id_unique` は Phase 56 で追加済を冪等 check
- **advisor 助言 3 件全採用**: ①`seedReservationStatuses` 不在確認 → seedFixture 簡素化、②Phase 57 schema diff 同形 verify、③ON DELETE 意味変化を §3 明記
- **Codex adversarial review CONDITIONAL-BLOCK**: BLOCK 2 + WARN 3 全採用 → plan v2 で軽量反映
  - BLOCK-1: `trg_reservation_transition` BEFORE INSERT trigger **本番未適用**確認 (`pg_trigger` 直接 query) → reservation status / status_transitions inline seed 削除
  - BLOCK-2: 観点 5 表現「commit 時 deferred check」→「statement-time check (NO ACTION non-deferrable)」に D1 文言で統一
- **5 観点 integration test 追加** (Phase 57 同形 / D2 簡素化版): cross-company / same-company / NULL / RESTRICT delete / statement-time check
- **Codex 委任 2 件** (auto-apply 済、修正周回**ゼロ**): adversarial review + implementation 一括
- **意味変化 `SET NULL → NO ACTION` 正当化**: data=0 + INSERT=0 + soft-delete 運用 + D1 統一 + auth.users CASCADE 経路は将来 cleanup 別 phase で対応 (WARN-1 採用記載)
- **drift 維持**: 0018 ALTER のみで drift 2 → 2 (drizzle-kit check "Everything's fine 🐶🔥")

## Claude 側の主要設計判断

1. **Phase 56/57 pattern 完全流用**: `NO ACTION` / `RESTRICT` / MATCH SIMPLE / raw migration authoritative / catalog query。Phase 57 d3dbd46 schema diff を完全模写
2. **D1/D2 差異の明示化**: 既存 FK ON DELETE = `SET NULL`、INSERT 経路 0、reservation status seed 未実装、trigger 不在 — Phase 57 とは独立に検証
3. **`pg_trigger` 直接 query で trigger 不在確証**: `20_triggers.sql` L1570-1572 の `trg_reservation_transition` 定義は code 上に存在するが**本番未適用** (apply-raw-sql.ts SKIP or migration runner 履歴) → reservation status / status_transitions の test inline seed 不要
4. **INSERT 棚卸し範囲拡張** (Codex WARN-2 採用): `src/ scripts/ seed/ tests/ supabase/ drizzle/ + SECURITY DEFINER RPC` を全て確認、本番経路 0 件確認
5. **`auth.users → public.users CASCADE` 経路 WARN 採用**: 将来 user offboarding で reservation_status_history が RESTRICT する可能性、soft-delete pattern 前提で許容、別 Phase で cleanup 順序実装

## Codex 委任成果

| del/blk id | task | 結果 |
|---|---|---|
| (adversarial-review v1) | plan v1 adversarial review | CONDITIONAL-BLOCK (BLOCK 2 / WARN 3) → plan v2 で全採用 |
| del-20260527-051504-7d1f (implementation) | migration 0018 + drizzle schema + 5 観点 test 一括 | applied / typecheck clean / 166/166 PASS / 5/5 新規 PASS / **修正 0 回** |

**Codex 出力品質**: Phase 43→44→...→55→56→57→**58** で 0→0→0→0→1→2→0→0→2→0→0→0→3→3→2→**2** (review 1 + implementation 1、**修正 0 回**で確定、Phase 55+57 同等の 1 発採用精度を 3 回目維持)。

## Phase 41-58 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-26 | Phase 31-A〜56 | 39-56 | (前 sealed.md 参照) |
| 27 | Codex WARN 6 (Phase 56) debt 台帳 D1 | 57 | `transport_order_status_history.changed_by_user_id` 複合 FK で company 整合 schema 強制 |
| **28** | Phase 57 sealed §Phase 58 推奨 #1、debt 台帳 D2 | **58** | `reservation_status_history.changed_by_user_id` 複合 FK で company 整合 schema 強制 (preventive hardening) |

## 残課題 / Phase 59 todo

### MVP blocker

- #1: 解消済 ✓ (Phase 50+51)
- #2: reservation cancel 遷移 (wake-up 領域)
- #3: Worker handler (wake-up 領域)
- #4: 解消済 ✓ (Phase 53+55)

### Phase 59 推奨スコープ候補

1. **debt 台帳 D3 (transport_order_invitations.invited_by_user_id 複合 FK)**: 優先度 中、**ADR-0008 必読・独立設計必須** (案件単位招待 + 複数業者打診で company 境界をまたぐ可能性)、INSERT 棚卸しを独立実施 (Phase 57 WARN-4 + Phase 58 棚卸し pattern 流用)
2. **debt 台帳 D4 (admin_vendor_invitations.invited_by_user_id 複合 FK)**: 優先度 低、規模軽微
3. **他 change_type service 実装 + change_log 統合**: vendor_changed / datetime_changed / rejected_reassigned / recreated いずれか、Phase 55 cancel pattern + Phase 56 FK 強制を活用
4. **drift 2 → 1 (0012 書き換え)** (Phase 54 sealed §残課題): 破壊的、慎重判断
5. **MVP blocker #2 #3** (wake-up 領域)
6. **transport_order.changed outbox worker 実装** (wake-up 領域)
7. **redaction policy 拡張** (`redact_transport_order_payload` 関数追加)
8. **reservation feature 実装着手** (Phase 58 で復活する `trg_reservation_transition` + reservation status seed function 追加 — D2 が protective rail として機能する)
9. **cancel test seedFixture 謎調査** (Phase 56 sealed §残課題、Phase 57-58 でも未着手)

### 一般 todo

(Phase 47-57 sealed 参照、変化なし)

## Phase 59 入力契約

### 参照すべきファイル

- 本 handoff (`phase-58-reservation-status-history-fk-sealed.md`)
- `phase-57-status-history-fk-sealed.md` (D1 元 pattern)
- `phase-56-changed-by-user-fk-sealed.md` (Phase 56 元 pattern)
- `phase-58-reservation-status-history-fk-plan.md` (v2 採用版、Codex review 反映済)
- `phase-58-codex-adversarial-review.md` (BLOCK 2 / WARN 3)
- `src/lib/db/raw-migrations/post/0018_reservation_status_history_user_company_composite_fk.sql` (D2 migration、D3-D4 横展開時に流用)
- `src/lib/db/raw-migrations/post/0017_status_history_user_company_composite_fk.sql` (Phase 57 元 pattern)
- `src/lib/db/raw-migrations/post/0016_change_logs_user_company_composite_fk.sql` (Phase 56 元 pattern)
- `src/lib/db/schema/reservation_status_history.ts` (D2 schema)
- `tests/integration/db/reservation-status-history-fk.integration.test.ts` (5 観点 / auth.users CTE / D1 比簡素化)
- spec/data-model.md §3.2 (users)、§3.10 (reservation_status_history)、§7.7 ("transport は reservation と同構造")、§15.7 (soft delete)、§17 (migration 順序)
- spec/CLAUDE.md ADR-0008 (D3 設計時**必読**)

### 絶対に壊してはいけないもの (invariants)

- 既修正 28 bug/機能すべてに retrogression なし
- typecheck clean / 20 test files / 166 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-57 確定)
- **Phase 58 複合 FK semantic 維持**: `(changed_by_user_id, company_id) → users(id, company_id)`, MATCH SIMPLE, ON DELETE NO ACTION, ON UPDATE RESTRICT
- **users(id, company_id) UNIQUE 維持** (Phase 56 で追加、Phase 57+58 で再利用、D3-D4 でも再利用)
- **drizzle-kit generate/push 禁止**: raw migration 0016+0017+0018 が authoritative
- **catalog query 冪等性 pattern 維持**: D3-D4 でも DO ブロック + `IF NOT EXISTS` / `IF EXISTS` + FOR LOOP DROP pattern 踏襲
- **auth.users CTE pattern 維持**: 新規 integration test の user INSERT は `WITH auth_user AS (INSERT INTO auth.users ...)` 必須

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 58 から、seal commit + feat commit で +2 予定)
- Phase 58 変更ファイル: 2 new (migration + test) + 1 modify (schema) + 2 plan/review + 1 seal = 6 files
- Codex 委任 2 件 (review + implementation)、advisor 呼び出し 1 件 (plan 前 approach 確認)
- **D3 (transport_order_invitations) 着手前に ADR-0008 を必読**: 案件単位招待 + 複数業者打診で `invited_by_user_id` が company 境界をまたぐ可能性、独立設計必須 (Phase 57 WARN-4 継承)
- INSERT 棚卸しは D3-D4 各々で **独立実施**（D2 棚卸しを流用しない）
- D2 で確認した「`20_triggers.sql` 末尾 trigger 未適用」現象は historical artifact (apply-raw-sql.ts SKIP)、別 Phase で原因調査推奨

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 58 commit 数 | 2 予定 (feat + 本 seal commit) |
| 変更ファイル | 2 new + 1 modify + 2 plan/review + 1 seal = 6 files |
| 修正済 latent bug / 機能追加 | 1 (#28 reservation_status_history changed_by_user_id 複合 FK — 累積 28) |
| advisor 呼び出し | 1 (plan v1 起草前 approach 確認) |
| Codex 委任 task 数 | 2 (adversarial review + implementation) |
| Codex sandbox-blocked | 0/2 (auto-apply 済) |
| Claude 側修正 (Codex 出力) | **0** (Phase 55+57 と同等、3 回目の 1 発採用) |
| test files | 20 (Phase 57 19 → +1) |
| integration + unit test 件数 | 166 (Phase 57 161 → +5) |
| 新規 test assertion | +5 (cross-company / same-company / NULL / RESTRICT delete / statement-time check) |
| 新規 migration | 1 (`0018_reservation_status_history_user_company_composite_fk.sql`) |
| 新規 SQL function | 0 |
| MVP blocker 解消 | 0 (preventive hardening) |
| drift | 2 → 2 (増加なし) |

## 振り返りメモ

- **trigger 不在の発見が plan を簡素化**: Codex BLOCK-1 で `pg_trigger` 直接確認 → `20_triggers.sql` 末尾 trigger 未適用判明、test seedFixture から reservation status / transition inline seed が削除可能に。Codex 第二意見が plan の誤前提を救った好例
- **D2 = preventive hardening**: service INSERT 経路 0 件、本番 trigger 不在、data 0、test 経路で初めて FK が動く構造。D1 と異なり「既存壊れる経路」皆無で純粋な future-proofing
- **意味変化 `SET NULL → NO ACTION` の慎重議論**: data=0 + INSERT=0 でリスク無視可能だが、auth.users CASCADE 経路への影響を WARN-1 で明文化。soft-delete 運用前提で許容、将来 cleanup 順序実装は別 Phase
- **3 回連続 1 発採用**: Phase 55 (3/3) → Phase 57 (2/2) → Phase 58 (2/2)。プロンプト中の「BLOCK-1/2 採用詳細」「auth.users CTE pattern 明示」「anti-pattern 列挙」が Codex 出力品質を安定化
- **連続 12 Phase 完走 (47-58)**: wake-up 領域回避しつつ 12 features (#17-#28) 追加。Phase 59 (D3) は ADR-0008 関連で重い可能性、独立設計必須

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 58 完了、累積 28 機能追加 + reservation_status_history 複合 FK 強制、debt 台帳 D2 解消、D3-D4 残)*
