# Phase 57 入力契約: Phase 56 changed_by_user_id composite FK sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 56 (前: 55 sealed) |
| 状態 | **sealed** (typecheck clean / 18 test files / 156 tests PASS / Phase 56 db FK 4/4) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope + plan v1/v2 + Codex review + seal) + Codex (adversarial review + implementation 委任 + test fix) |
| 前 handoff | `phase-55-change-logs-integration-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 55 `04b8c21` から +1 予定) |

## 達成したこと (Phase 56)

- **Codex WARN 4 後送解消 完了**: `transport_order_change_logs.changed_by_user_id` の company 整合を schema レベルで保証、admin role middleware に頼らない多層防御化
  - 複合 FK `(changed_by_user_id, company_id) → users(id, company_id)` 追加 (MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT)
  - users 側に `UNIQUE(id, company_id)` 追加 (PK の冗長 superset、複合 FK 参照先用)
  - 既存単独 FK (drizzle 自動生成名) を catalog query で特定 → DROP CONSTRAINT → 複合 FK 入替
  - DO ブロックで冪等性確保 (`IF NOT EXISTS` / `IF EXISTS` パターン)
- **Codex adversarial review 完遂**: CONDITIONAL-GO → BLOCK 2 解決経路変更 (列指定 SET NULL → NO ACTION) + WARN 6 全採用、plan v2 で反映後実装
- **TDD 規律遵守**: RED (test 4 件追加、users_id_fkey 違反で全 fail) → seedFixture fix (auth.users CTE pattern) → GREEN (4/4 PASS)
- **Codex 委任 3 件** (全て auto-apply 済): adversarial-review + implementation (migration + schema + test) + test fix
- **複合 FK 挙動 4 観点 assert 完備**: cross-company INSERT 失敗 / same-company INSERT 成功 / NULL 許可 (MATCH SIMPLE) / user hard delete RESTRICT (NO ACTION)
- **drift 維持**: 0016 ALTER のみで drift 2 → 2 (増加なし)

## Claude 側の主要設計判断

1. **複合 FK 採択 (Option A)**: trigger / CHECK 関数より DB native で堅牢、Postgres 標準パターン、Codex review でも GO 相当
2. **`ON DELETE NO ACTION` 採用 (Codex BLOCK 1 経路変更)**: 列指定 `SET NULL (changed_by_user_id)` は Postgres 15+ 依存 + drizzle 0.36.4 表現不可 (BLOCK 2)。spec §15.7 で soft delete only、hard delete は監査クリーンアップ限定なので actor NULL 化要件は実用上不要、NO ACTION で audit 整合保護優先
3. **`ON UPDATE RESTRICT`**: admin による users.company_id 変更を schema 強制禁止 (運用前提を DB 強制)
4. **drizzle schema authoritative なし**: raw migration 0016 が authoritative、drizzle-kit generate/push 禁止運用を schema コメントで明記 (BLOCK 2 残余対応)
5. **既存単独 FK 削除**: 二重制約回避 (Codex WARN 1 採用)、column-level `.references()` を schema から削除 + table-level composite `foreignKey({...})` のみ
6. **catalog query で FK 名特定**: drizzle 自動生成名に依存せず `pg_constraint` から動的特定 (Codex WARN 3 採用)、冪等性確保
7. **test は DB 直接 INSERT/DELETE**: service 層経由ではなく drizzle outerTx で直接、制約挙動を 4 観点で個別確認 (Codex WARN 5 採用)
8. **auth.users CTE pattern**: seedFixture 内 user INSERT は `auth.users` への WITH 句経由 (既存 record-audit-log.test.ts pattern)、`users_id_fkey` 違反回避
9. **横展開は debt 台帳化**: status_history × 2 / invitations × 2 を D1-D4 として優先度付き明示、Phase 57+ で順次対応 (Codex WARN 6 採用)

## Codex 委任成果

| del/blk id | task | 結果 |
|---|---|---|
| (adversarial-review v1) | plan v1 adversarial review | CONDITIONAL-GO (BLOCK 2 + WARN 6) → plan v2 で BLOCK 1/2 経路変更 + WARN 全採用 |
| (implementation 1) | migration 0016 + drizzle schema 2 + test 1 一括 | applied / typecheck clean / migration apply 成功 |
| (test fix) | seedFixture を auth.users CTE pattern に修正 | applied / typecheck clean / 4/4 GREEN 達成 |

**Codex 出力品質**: Phase 43→44→45→46→47→48→49→50→51→52→53→54→55→56 で 0→0→0→0→1→2→0→0→2→0→0→0→3→**3** (review 1 + implementation 1 + test fix 1、修正 1 回 (users_id_fkey 違反) で確定)。

## Phase 41-56 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-25 | Phase 31-A〜55 | 39-55 | (前 sealed.md 参照) |
| **26** | Codex WARN 4 後送 (Phase 55) | **56** | `transport_order_change_logs.changed_by_user_id` 複合 FK で company 整合 schema 強制 |

## 残課題 / Phase 57 todo

### MVP blocker

- **#1**: 解消済 ✓ (Phase 50+51)
- **#2**: reservation cancel 遷移 (wake-up 領域)
- **#3**: Worker handler (wake-up 領域)
- **#4**: 解消済 ✓ (Phase 53+55)

### Phase 57 推奨スコープ候補

1. **debt 台帳 D1 (transport_order_status_history.changed_by_user_id 複合 FK)**: Phase 56 同 pattern 横展開、優先度 **高** (status 遷移 audit、頻出 + critical action)、規模軽微 (migration 1 + schema 1 + test 数件)
2. **debt 台帳 D2 (reservation_status_history.changed_by_user_id 複合 FK)**: 優先度 中
3. **debt 台帳 D3 (transport_order_invitations.invited_by_user_id 複合 FK)**: 優先度 中、§ADR-0008 関連
4. **debt 台帳 D4 (admin_vendor_invitations.invited_by_user_id 複合 FK)**: 優先度 低
5. **他 change_type service 実装 + change_log 統合** (Phase 55 sealed §推奨 #1 の残課題): vendor_changed / datetime_changed / rejected_reassigned / recreated いずれかを service ごと新規実装、Phase 55 cancel pattern + Phase 56 FK 強制を活用
6. **drift 2 → 1 (0012 書き換え)** (Phase 54 sealed §残課題): 破壊的、慎重判断
7. **MVP blocker #2 #3** (wake-up 領域)
8. **transport_order.changed outbox worker 実装** (wake-up 領域)
9. **redaction policy 拡張** (`redact_transport_order_payload` 関数追加)
10. **cancel test seedFixture が `crypto.randomUUID()` で users INSERT しているのに users_id_fkey 違反しない謎の調査** (Phase 56 で発見、Phase 56 test では同じ pattern で fail、別 PASS する理由を要解明)

### 一般 todo

(Phase 47-55 sealed 参照、変化なし)

## Phase 57 入力契約

### 参照すべきファイル

- 本 handoff (`phase-56-changed-by-user-fk-sealed.md`)
- `phase-55-change-logs-integration-sealed.md`
- `phase-56-changed-by-user-fk-plan.md` (v2 採用版、Codex review 反映済)
- `src/lib/db/raw-migrations/post/0016_change_logs_user_company_composite_fk.sql` (Phase 56 migration、DO ブロック冪等性 pattern を D1-D4 で再利用)
- `src/lib/db/schema/transport_order_change_logs.ts` (composite FK 表現、`drizzle-kit generate/push 禁止` コメント参照)
- `src/lib/db/schema/users.ts` (`users_id_company_id_unique` 追加済、D1-D4 でも再利用可)
- `tests/integration/db/transport-order-change-logs-fk.integration.test.ts` (Phase 56 test、4 観点 assert pattern を D1-D4 で再利用、auth.users CTE pattern)
- `tests/integration/record-audit-log.test.ts` (auth.users CTE pattern 元参考)
- spec/data-model.md §3.2 (users)、§7.8 (transport_order_change_logs)、§15.7 (soft delete)、§17 (migration 順序)

### 絶対に壊してはいけないもの (invariants)

- 既修正 26 bug/機能すべてに retrogression なし
- typecheck clean / 18 test files / 156 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-55 確定)
- **Phase 56 複合 FK semantic 維持**: `(changed_by_user_id, company_id) → users(id, company_id)`, MATCH SIMPLE, ON DELETE NO ACTION, ON UPDATE RESTRICT
- **users(id, company_id) UNIQUE 維持**: 複合 FK 参照先、削除/変更禁止
- **drizzle-kit generate/push 禁止**: raw migration 0016 が authoritative、drizzle schema は表現のみ
- **catalog query 冪等性 pattern 維持**: D1-D4 横展開時も DO ブロック + `IF NOT EXISTS` / `IF EXISTS` + FOR LOOP DROP pattern を踏襲
- **auth.users CTE pattern 維持**: 新規 integration test で user INSERT する場合は `WITH auth_user AS (INSERT INTO auth.users ...)` を必ず経由

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 56 commit +1 予定、Phase 55 `04b8c21` から)
- Phase 56 変更ファイル: 2 modify (schema) + 2 new (migration + test) + 1 new (plan) = 5 files
- Codex 委任 3 件 (review + implementation + test fix)、advisor 呼び出し 1 件 (scope 確定)
- 列指定 `SET NULL (col)` は Postgres 15+ 必要だが、本 Phase では `NO ACTION` 採用で回避
- D1 (transport_order_status_history) 横展開時は同 pattern 流用可、ただし status_history は data 蓄積あり (recreate 不可) で migration 慎重

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 56 commit 数 | 1 予定 (Phase 55 `04b8c21` から +1) |
| 変更ファイル | 2 modify + 2 new + 1 plan = 5 files |
| 修正済 latent bug / 機能追加 | 1 (#26 changed_by_user_id 複合 FK — 累積 26) |
| advisor 呼び出し | 1 (Phase 56 scope 確定で実施) |
| Codex 委任 task 数 | 3 (adversarial review + implementation + test fix) |
| Codex sandbox-blocked | 0/3 |
| Claude 側修正 (Codex 出力) | 1 (users_id_fkey 違反 → auth.users CTE pattern 適用、test fix 委任で解消) |
| test files | 18 (Phase 55 17 → +1) |
| integration + unit test 件数 | 156 (Phase 55 152 → +4) |
| 新規 test assertion | +4 (cross-company INSERT 失敗 / same-company 成功 / NULL 許可 / user hard delete RESTRICT) |
| 新規 migration | 1 (`0016_change_logs_user_company_composite_fk.sql`) |
| 新規 SQL function | 0 |
| MVP blocker 解消 | 0 (hardening follow-up) |
| drift | 2 → 2 (増加なし) |

## 振り返りメモ

- **Codex review が plan v1 の致命的設計ミスを発見**: BLOCK 1 (`ON DELETE SET NULL` が複合 FK で全列 NULL 化 = company_id NOT NULL 違反) は plan v1 のままだと user delete が一切できなくなる致命的バグ。BLOCK 2 (drizzle 表現限界) も同時発見、plan v2 で `NO ACTION` 採用に経路変更したことで両方解消。adversarial-review 投資の典型的価値
- **Codex 委任 3 件中 1 件修正**: implementation 委任後に test が users_id_fkey で全 4 fail、原因は seedFixture が `crypto.randomUUID()` で users INSERT (auth.users CTE 経由なし)。Codex に test fix 再委任で解消。Phase 55 (3/3 全件 1 回採用) よりやや劣るが、修正経路は 1 回で確定
- **既存 cancel test がなぜ通っているか謎**: 同じ `crypto.randomUUID()` で users INSERT する cancel test (Phase 55) は 12/12 PASS、Phase 56 test は同 pattern で 4/4 fail。test 環境設定の何かが違うが原因未特定、Phase 57 todo として記録
- **TDD 順序が機能**: RED (test 追加 → users_id_fkey で全 fail) → seedFixture fix (auth.users CTE) → GREEN (4/4) → 既存 152 tests retrogression 確認で 156/156 全件 PASS
- **連続 10 Phase 完走 (47-56)**: wake-up 領域を回避しつつ 10 features 追加 (#17-#26)、規律安定
- **Codex review BLOCK 採用が経路変更を促した**: BLOCK 1/2 をそのまま rejection ではなく「BLOCK の根本原因を解決する別経路」に置き換えた (列指定 SET NULL → NO ACTION)。spec §15.7 soft delete only という外部制約が経路変更を可能にした

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 56 完了、累積 26 機能追加 + changed_by_user_id 複合 FK 強制、Codex WARN 4 後送解消、debt 台帳 D1-D4 明示)*
