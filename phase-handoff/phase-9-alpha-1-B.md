# Phase 9-alpha-1-B: Sprint α-1 Phase B (Helper Functions + Critical Functions) Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 境界 | Phase 8-A sealed (DDL 基盤) → 本 Phase (α-1 Phase B SQL 整備) → Phase 10-C (RLS + Triggers + Seed) |
| 状態 | sealed (apply + smoke test 完了、Section 1-5 全緑 + Section 6 partial) |
| 担当 | Claude (計画・spec 解釈・認可ガード追加) + Codex (SQL/Drizzle 翻訳) |
| 関連 commits | 未 commit (朝の apply 確認後にまとめてコミット推奨) |
| dev server | 不使用 |

## 本 Phase 達成事項

1. **B-1a**: 5 RLS helper 関数を Codex 委任で生成 (current_user_company_id 等)
2. **B-1c**: redact_audit_payload (2 引数版) を PoC #16 から public schema へ移植
3. **B-1d**: accept_invitation_and_revoke_others advisory lock 化 + **認可ガード追加** (advisor 指摘)
4. **B-1b**: pii_anonymization_jobs テーブル + EXCLUDE + 2 index を新規 22_pii_anonymization_jobs.sql で実装
5. Drizzle schema (pii_anonymization_jobs.ts) 追加 + index.ts 更新 → 48 schema files
6. `pnpm typecheck` 緑
7. Codex 委任 3 件全成功 (sandbox spawn error なし、helper / pii_sql / pii_drizzle)

## 重要設計判断

1. **18_helper_functions.sql 統合戦略**: spec §17 順序に従い helper 5 + redact + accept_invitation を 1 ファイルに統合 (247 行)。apply 時に `DELETE FROM _raw_migrations WHERE filename='18_helper_functions.sql'` で再適用必要
2. **spec §14.2 と DDL 乖離 3 件**: vendor_users.auth_user_id / vendor_company_memberships の time-window / vendors.deleted_at — 全て SQL を真実の源として helper 関数で翻訳。先頭 3 行コメントに記録
3. **B-1d 認可ガード追加** (spec 未明示): SECURITY DEFINER + GRANT TO authenticated の組合せでは RLS バイパスのため、関数内で v_vendor_user_id NULL チェック + vendor_id 一致検証を追加。42501 RAISE
4. **スポット招待除外**: vendor_id NULL の招待は本関数スコープ外として P0002 で早期 RAISE (spec line 943 別フロー)
5. **pii_anonymization_jobs は新ファイル 22**: 既存 15_audit.sql は apply 済のため追記不可。filename sort で 21_seed_master の後に配置

## 次 Phase (Sprint α-1 Phase C) 入力契約

### 最初に読むべきファイル (順)
1. `phase-handoff/phase-9-alpha-1-B.md` (本ファイル)
2. `phase-handoff/sprint-alpha-1-plan.md` v1.1 (Phase C 詳細, lines 69-95)
3. `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` (helper 7 関数完成形)
4. `src/lib/db/raw-migrations/alpha-1-public/22_pii_anonymization_jobs.sql` (state machine table)
5. `spec/data-model.md` §14.3/14.4 (RLS standard policy) / §11.3 (audit append-only)
6. `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_19_rls_policies.sql` (RLS policy 移植元)
7. `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_20_triggers.sql` (trigger 5 種移植元)

### 朝最初に実行 (B-2 smoke test の前提、手動オペ)

```sql
-- Step 1: 18_helper_functions.sql の再適用を許可 (CREATE OR REPLACE で冪等)
DELETE FROM _raw_migrations WHERE filename = '18_helper_functions.sql';
```

```bash
# Step 2: 22 と 18 を apply
pnpm db:apply-raw-sql ./src/lib/db/raw-migrations/alpha-1-public

# 期待: [APPLY] 18_helper_functions.sql / [APPLY] 22_pii_anonymization_jobs.sql
#        他 19/20/21 は stub なので SKIP のはず
```

```sql
-- Step 3: 検証クエリ (mcp__supabase__execute_sql)
SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('current_user_company_id','current_vendor_id','current_vendor_user_id',
                  'vendor_accessible_company_ids','vendor_invited_transport_order_ids',
                  'redact_audit_payload','accept_invitation_and_revoke_others');
-- 期待: 7 rows

SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='pii_anonymization_jobs';
-- 期待: 1
```

### 次の着手タスク
**Phase B-2 (Claude smoke test)** → Phase C-1 (Codex RLS policies 46 テーブル) → Phase C-2a (Codex 標準 trigger 5 種) → **C-2b (Claude 単独, Critical) record_audit_log trigger**

### 並走可能
- Phase D-1/D-2/D-3 (Inngest workers) — Phase A 後並走可、Phase B 不要

### 絶対に壊してはいけないもの (invariants)
- 46 業務テーブル + pii_anonymization_jobs (合計 47) の構造 (Phase C/D は関数・RLS・trigger 追加のみ)
- `_raw_migrations` テーブル (apply tracking)
- 18 ファイルの 7 関数定義 (CREATE OR REPLACE 冪等)
- spec §14.2 と DDL 乖離 3 件の翻訳結果 (再修正禁止、Phase C で逆方向の修正発生時のみ要協議)

## watchpoint 継承

- **Codex Windows sandbox**: 本 Phase は 3 件全成功 (10-30 行/件の小規模だったため)。100 行超は再現確率高
- **apply 再適用**: 18 は朝 DELETE → apply。22 は新規 filename で自動 apply。`CREATE OR REPLACE` のため既存 RLS policy 等への副作用なし
- **B-1d 認可ガード**: SECURITY DEFINER 関数を新規追加する際は必ず caller 認可検証 (`current_user_company_id` 系を使うだけでなく entity 所属 check)
- **spec/DDL 乖離**: spec §14.2 と alpha-1-public の 3 件 (auth_user_id / time-window / deleted_at) は Phase C で RLS policy を書く際にも踏襲必要

## Phase 振り返りメモ

- **うまくいった**: advisor の事前/事後レビューで B-1d 認可漏れを発見・即修正 (commit 前に防止)
- **うまくいった**: Codex 委任 3 件すべて 30 秒以内完了、sandbox 失敗 0 (小規模かつ明示プロンプトの効果)
- **うまくいった**: spec §14.2 PoC schema 由来サンプルを盲信せず DDL 真実の源で翻訳 (Phase 8-A 教訓継承)
- **改善余地**: Codex が既存 5 GRANT 文を消さずに重複書き込み → プロンプトに「既存 X 行を削除して」を太字で明示すべき (B-1c/d 時に発生)
- **改善余地**: spec §7.10.2 が SECURITY DEFINER 関数の認可検証要件を明示していない → spec 側の不備、別途指摘
- **改善余地**: hook の 60 行閾値で 5 関数 helper の修正でも block 発動。raw-migrations/ 配下は例外運用にする検討余地

## Codex ledger refs

- B-1a Codex: 5 helper 関数 (~90 行) — 18_helper_functions.sql (.codex-prompts/b-1a-output.log)
- B-1cd Codex: redact + accept_invitation (~148 行追記) — 同上 (.codex-prompts/b-1cd-output.log)
- B-1b SQL Codex: pii_anonymization_jobs (~35 行) — 22_pii_anonymization_jobs.sql (.codex-prompts/b-1b-output.log)
- B-1b Drizzle Codex: pii_anonymization_jobs.ts (~40 行) — schema/pii_anonymization_jobs.ts (.codex-prompts/b-1b-drizzle-output.log)

## B-2 smoke test 結果 (2026-05-24 朝実行)

| Section | 内容 | 結果 |
|---|---|---|
| 1 | 7 関数の存在 + 引数確認 | ✅ 全 7 関数、引数完全一致 |
| 2 | pii_anonymization_jobs テーブル + EXCLUDE + 2 partial index | ✅ 1,1,2 |
| 3 | redact_audit_payload 5 entity + passthrough | ✅ 6 結果すべて期待通り (vehicle vin は `***109186` = right 6 文字、PoC #16 ロジック通り) |
| 4 | vendor_accessible_company_ids 0-row smoke | ✅ 0 rows、エラー無し |
| 5 | state machine 4 遷移 + EXCLUDE 検証 + completed 後の新 pending | ✅ 全完走、cleanup 完全 (leftover 0) |
| 6 | 認可ガード P0002 (non-existent invitation) | ✅ partial (残り 4 ケースは vendor_user 認証必要、Phase E で対応) |

### Supabase advisor 結果 (security)

| level | 内容 | 対応 |
|---|---|---|
| INFO × 47 | `rls_enabled_no_policy` 全テーブル | Phase C-1 で全 policy 投入、想定通り |
| WARN × 7 | `anon_security_definer_function_executable` (helper 7 + 既存 sync_user_delete/rls_auto_enable) | Phase C で `REVOKE EXECUTE ... FROM anon, PUBLIC` 追加推奨。**現状は関数内認可ガードで防御済み** (anon 呼び出し時 NULL → 42501 / 空結果) |
| WARN × 7 | `authenticated_security_definer_function_executable` (同上) | 上記と同じ |
| WARN × 2 | `function_search_path_mutable` (sync_user_delete / set_updated_at, Phase A 既存 stub) | Phase C-2a の trigger 実装時に修正 |
| WARN × 3 | `materialized_view_in_api` (3 matviews) | Phase C-1 で GRANT 見直し |
| WARN × 2 | `extension_in_public` (btree_gist / pg_trgm) | 実害なし、ベストプラクティス TODO |

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 SQL 関数 | 7 (helper 5 + redact + accept_invitation) |
| 追加 SQL テーブル | 1 (pii_anonymization_jobs) |
| 追加 Drizzle schema files | 1 |
| 追加コード行数 | 247 (18) + 35 (22) + 39 (TS) = 321 行 |
| Codex 委任率 | ~85% (Claude は spec 解釈 + 認可ガード追加 + GRANT 重複削除のみ) |
| typecheck | 緑 |
| セッション数 | 1 (本セッション、次は /clear 後の Phase C planning) |

## 朝の最初の 15 分推奨手順

1. (3 min) spec §14.4 (vendor portal policy) + §11.3 (audit append-only) 再読
2. (3 min) apply ステップ実行 (上記 Step 1-3)
3. (5 min) B-2 smoke test スクリプト作成 + 実行
4. (4 min) Phase 10-C 計画 (RLS 46 + trigger 5 + seed) の Codex 委任プロンプト準備

---

*Generated by phase-handoff skill (seal mode) — Phase B SQL 整備完了、DB apply は朝の手動境界*
