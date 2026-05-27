# Phase 58 入力契約: Phase 57 status_history changed_by_user_id composite FK sealed (D1 解消)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 57 (前: 56 sealed) |
| 状態 | **sealed** (typecheck clean / 19 test files / 161 tests PASS / Phase 57 db FK 5/5) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope + plan v1/v2 + advisor + Codex review + seal) + Codex (adversarial review + implementation 委任) |
| 前 handoff | `phase-56-changed-by-user-fk-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 56 `2836901` から +1: `d3dbd46`) |

## 達成したこと (Phase 57)

- **debt 台帳 D1 解消**: `transport_order_status_history.changed_by_user_id` の company 整合を schema レベルで強制
  - 複合 FK `(changed_by_user_id, company_id) → users(id, company_id)` 追加 (MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT)
  - 既存単独 FK (drizzle 自動生成名) を catalog query で特定 → DROP CONSTRAINT
  - `users_id_company_id_unique` は Phase 56 で追加済を冪等 check（再追加なし）
- **advisor 助言 1 件採用**: plan v1 起草前に INSERT 棚卸し（service write 整合性スナップショット）を実施、§1 に組込み
- **Codex adversarial review CONDITIONAL-GO**: BLOCK 0 / WARN 6 全採用 → plan v2 で軽量反映（Phase 56 のような経路変更不要）
- **5 観点 integration test 追加** (Phase 56 の 4 観点 + WARN-5 で deferred check 観点 5):
  1. cross-company INSERT 失敗 / 2. same-company 成功 / 3. NULL 許可 / 4. user hard delete RESTRICT / 5. deferred check
- **Codex 委任 2 件** (auto-apply 済、test fix 周回**ゼロ**): adversarial review + implementation 一括（Phase 56 は 3 件中 1 周回、改善）
- **TDD 規律遵守**: plan v2 で seedFixture を最初から `auth.users` CTE pattern 明示 → 1 発採用達成（Phase 56 で発生した users_id_fkey 違反を回避）
- **drift 維持**: 0017 ALTER のみで drift 2 → 2（増加なし、drizzle-kit check OK）

## Claude 側の主要設計判断

1. **Phase 56 pattern 完全流用**: `NO ACTION` / `RESTRICT` / MATCH SIMPLE / raw migration authoritative。Phase 56 で BLOCK 1/2 を経路変更した教訓を反映済、再評価不要
2. **本番 data=0 検証で migration 慎重論を緩和**: Phase 56 sealed の「data 蓄積あり (recreate 不可)」前提を Supabase 直接 query で覆す。`transport_order_status_history` total=0、D2-D4 全テーブルも total=0
3. **INSERT 棚卸し 6 箇所確認** (plan v1 では 5 を見落とし): services 2 件 (#1, #2: actingUserId/userId)、raw-migration 4 件 (全て NULL 固定で安全) — post/0008 を WARN-1 で追加発見
4. **seedFixture `auth.users` CTE pattern を plan v2 で**最初から**明示**: Phase 56 で 1 周回した users_id_fkey 違反を完全回避。advisor 助言 + 既存 test 流用で 1 発採用
5. **WARN-3 (DO ブロック EXCEPTION) は 0016 と同等構造で運用踏襲**: production で 0016 適用実績ありの方針継承
6. **WARN-4 D2-D4 横展開警戒**: §10 に「D2-D4 各 phase で §1 相当の INSERT 棚卸しを独立実施」明記、特に D3 (transport_order_invitations) は ADR-0008 関連で独立設計必須

## Codex 委任成果

| del/blk id | task | 結果 |
|---|---|---|
| (adversarial-review v1) | plan v1 adversarial review | CONDITIONAL-GO (BLOCK 0 / WARN 6) → plan v2 で WARN 全採用 |
| del-20260527-033455-d538 (implementation) | migration 0017 + drizzle schema + 5 観点 test 一括 | applied / typecheck clean / 161/161 PASS / 5/5 新規 PASS (**1 発採用**) |

**Codex 出力品質**: Phase 43→44→45→46→47→48→49→50→51→52→53→54→55→56→**57** で 0→0→0→0→1→2→0→0→2→0→0→0→3→3→**2** (review 1 + implementation 1、**修正 0 回**で確定、Phase 55 (3/3 1 発) 並みの精度)。

## Phase 41-57 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-26 | Phase 31-A〜56 | 39-56 | (前 sealed.md 参照) |
| **27** | Codex WARN 6 (Phase 56) debt 台帳 D1 | **57** | `transport_order_status_history.changed_by_user_id` 複合 FK で company 整合 schema 強制 |

## 残課題 / Phase 58 todo

### MVP blocker

- **#1**: 解消済 ✓ (Phase 50+51)
- **#2**: reservation cancel 遷移 (wake-up 領域)
- **#3**: Worker handler (wake-up 領域)
- **#4**: 解消済 ✓ (Phase 53+55)

### Phase 58 推奨スコープ候補

1. **debt 台帳 D2 (reservation_status_history.changed_by_user_id 複合 FK)**: Phase 57 D1 と完全同 pattern 流用可、優先度 **高**、規模軽微（migration 1 + schema 1 + test 5 観点）、data=0 確認済
2. **debt 台帳 D3 (transport_order_invitations.invited_by_user_id 複合 FK)**: 優先度 中、**ADR-0008 関連で独立設計必須**（WARN-4）、INSERT 棚卸しを独立実施
3. **debt 台帳 D4 (admin_vendor_invitations.invited_by_user_id 複合 FK)**: 優先度 低、規模軽微
4. **他 change_type service 実装 + change_log 統合** (Phase 56 sealed §推奨 #5): vendor_changed / datetime_changed / rejected_reassigned / recreated いずれか、Phase 55 cancel pattern + Phase 56 FK 強制を活用
5. **drift 2 → 1 (0012 書き換え)** (Phase 54 sealed §残課題): 破壊的、慎重判断
6. **MVP blocker #2 #3** (wake-up 領域)
7. **transport_order.changed outbox worker 実装** (wake-up 領域)
8. **redaction policy 拡張** (`redact_transport_order_payload` 関数追加)
9. **cancel test seedFixture 謎調査** (Phase 56 sealed §残課題、Phase 57 でも未着手、両 test が異なる挙動を取る理由要解明)

### 一般 todo

(Phase 47-56 sealed 参照、変化なし)

## Phase 58 入力契約

### 参照すべきファイル

- 本 handoff (`phase-57-status-history-fk-sealed.md`)
- `phase-56-changed-by-user-fk-sealed.md`
- `phase-57-status-history-fk-plan.md` (v2 採用版、Codex review 反映済)
- `phase-57-codex-adversarial-review.md` (BLOCK 0 / WARN 6)
- `src/lib/db/raw-migrations/post/0017_status_history_user_company_composite_fk.sql` (D1 migration、D2-D4 横展開時に流用)
- `src/lib/db/raw-migrations/post/0016_change_logs_user_company_composite_fk.sql` (Phase 56 元 pattern)
- `src/lib/db/schema/transport_order_status_history.ts` (D1 schema)
- `tests/integration/db/transport-order-status-history-fk.integration.test.ts` (5 観点 + auth.users CTE pattern)
- spec/data-model.md §3.2 (users)、§3.11 (status_history)、§15.7 (soft delete)、§17 (migration 順序)
- spec/CLAUDE.md ADR-0008 (D3 設計時必読)

### 絶対に壊してはいけないもの (invariants)

- 既修正 27 bug/機能すべてに retrogression なし
- typecheck clean / 19 test files / 161 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-56 確定)
- **Phase 57 複合 FK semantic 維持**: `(changed_by_user_id, company_id) → users(id, company_id)`, MATCH SIMPLE, ON DELETE NO ACTION, ON UPDATE RESTRICT
- **users(id, company_id) UNIQUE 維持** (Phase 56 で追加、Phase 57 で再利用、D2-D4 でも再利用)
- **drizzle-kit generate/push 禁止**: raw migration 0016+0017 が authoritative
- **catalog query 冪等性 pattern 維持**: D2-D4 でも DO ブロック + `IF NOT EXISTS` / `IF EXISTS` + FOR LOOP DROP pattern 踏襲
- **auth.users CTE pattern 維持**: 新規 integration test の user INSERT は `WITH auth_user AS (INSERT INTO auth.users ...)` 必須

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 57 `d3dbd46` から、seal commit で +1 予定)
- Phase 57 変更ファイル: 2 new (migration + test) + 1 modify (schema) + 2 plan/review + 1 seal = 6 files
- Codex 委任 2 件 (review + implementation)、advisor 呼び出し 1 件 (plan 前 approach 確認)
- D2 (reservation_status_history) は D1 と完全同 pattern で連続着手可
- **D3 (transport_order_invitations) 着手前に ADR-0008 を必読**: 案件単位招待 + 複数業者打診で `invited_by_user_id` が company 境界をまたぐ可能性、独立設計必須 (WARN-4)
- INSERT 棚卸しは D2-D4 各々で **独立実施**（D1 棚卸しを流用しない）

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 57 commit 数 | 2 予定 (feat `d3dbd46` + 本 seal commit) |
| 変更ファイル | 2 new + 1 modify + 2 plan/review + 1 seal = 6 files |
| 修正済 latent bug / 機能追加 | 1 (#27 status_history changed_by_user_id 複合 FK — 累積 27) |
| advisor 呼び出し | 1 (plan v1 起草前 approach 確認) |
| Codex 委任 task 数 | 2 (adversarial review + implementation) |
| Codex sandbox-blocked | 0/2 (Codex 報告: apply_patch が read-only block → Claude 直接 Write 経路で完了) |
| Claude 側修正 (Codex 出力) | **0** (Phase 56 の 1 回から改善) |
| test files | 19 (Phase 56 18 → +1) |
| integration + unit test 件数 | 161 (Phase 56 156 → +5) |
| 新規 test assertion | +5 (cross-company / same-company / NULL / RESTRICT delete / deferred check) |
| 新規 migration | 1 (`0017_status_history_user_company_composite_fk.sql`) |
| 新規 SQL function | 0 |
| MVP blocker 解消 | 0 (hardening follow-up) |
| drift | 2 → 2 (増加なし、drizzle-kit check OK) |

## 振り返りメモ

- **本番 data=0 が前提を覆した**: Phase 56 sealed の「status_history は data 蓄積あり (recreate 不可)」は事実と異なる。Supabase 直接 query で D1-D4 全テーブル total=0 を確認、横展開全体が低リスクで進められる見通しに更新
- **Codex review BLOCK 0**: Phase 56 で BLOCK 1/2 検出した経路変更が Phase 57 plan v1 で事前に組込まれていたため、approach 変更不要。Phase 56 の教訓が次 phase に反映された好例
- **TDD 1 発採用**: plan v2 で `auth.users` CTE pattern を seedFixture に最初から明示したことで、Phase 56 の users_id_fkey 周回（1 回）を完全回避。委任プロンプトに pattern を埋め込むことで Codex 出力品質が安定
- **WARN 6 全採用の軽量さ**: BLOCK 0 だと plan v2 反映は §1 棚卸し更新 + §6 観点 5 追加 + §9 DoD 1 行 + §10 注記の 4 箇所で済む。Phase 56 (経路変更 + drizzle 限界回避) と比較して軽量
- **連続 11 Phase 完走 (47-57)**: wake-up 領域を回避しつつ 11 features 追加 (#17-#27)、規律安定。Phase 58 (D2) も同 pattern で連続実装見込み

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 57 完了、累積 27 機能追加 + status_history 複合 FK 強制、debt 台帳 D1 解消、D2-D4 残)*
