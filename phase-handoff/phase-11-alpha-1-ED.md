# Phase 11-alpha-1-ED: Sprint α-1 Phase E partial + D-1 Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 境界 | Phase 10-C sealed (RLS + triggers) → 本 Phase (E-1/E-2 partial/D-1 setup/cleanup) → Phase 12 (D-2 outbox + E-2 残 18 ケース) |
| 状態 | sealed (E-1 完全 / E-2 Tier 1-4 完成 / D-1 setup / fresh-apply 健全化) |
| 担当 | Codex (E-1 fixture + E-2 vitest + D-1 boilerplate) + Claude (typecheck/SECURITY DEFINER fix/cleanup) |
| 関連 commits | `9204935` (E-2), `daff133` (E-1+helper fix), `277220c` (D-1), `bf60dba` (cleanup+roadmap) |

## 本 Phase 達成事項

1. **E-2 Tier 1-4** (Codex + Claude fix): `tests/integration/record-audit-log.test.ts` 9 assertions (customers/vehicles/vendor_users/vendors/soft-delete-restore)、全 redaction expected 値検証、`BEGIN/__rollback__` で痕跡無し。9/9 PASS
3. **C-2b bug 発見**: E-2 が record_audit_log の `NEW IS NOT NULL` SQL 標準挙動を捕まえた → Phase 10-C で TG_OP 分岐に修正済
4. **E-1** (Codex + Claude fix): `tests/integration/tenant-isolation.test.ts` 8 assertions (admin A own only / admin B 0 / vendor_user 0 / anon 0 / current_vendor_id / vendor_accessible_company_ids / current_user_company_id NULL/positive)、auth.users fixture in-transaction、Sprint α-1 DoD「RLS 漏洩 0」達成。8/8 PASS
5. **helper SECURITY DEFINER fix**: vendor_accessible_company_ids / vendor_invited_transport_order_ids に SECURITY DEFINER 追加。PoC は SECURITY DEFINER だったが Phase B-1a で誤って外していた (E-1 testing が defect 検出)
6. **fresh-apply 健全化**: `_raw_migrations` の 18_helper_functions.sql 行 DELETE → 再 apply 確認、E-1 still 8/8 PASS。CI/新環境再現性保証
7. **D-1** (Codex): Inngest client.ts (~18 行) + serve route.ts (~12 行) + package.json inngest 依存追加。Phase D-2/D-3 で functions 配列に追加予定
8. **PoC test cleanup**: poc-02 (parallel-reservation) と poc-13 (optimistic-locking) を削除 (Phase 8-A で `_reservations_slice_test`/`_version_test` DROP 済の遺物)。`pnpm test` 18/18 PASS、CI 緑
9. **roadmap.md line 95 fix**: `vendor_sla_overrides` → `vendor_available_days` (Sprint α-1 plan v1.1 DoD 反映)

## 重要設計判断

1. **E-2 scope 制限**: Plan §E-2 「27 assertions」のうち Tier 1-4 (9 assertions) のみ。残 18 (users / customer_reservation_tokens / service_tickets / reservations / transport_orders / transport_order_invitations) は fixture builder 整備が必要で本 Phase スコープ外
2. **vendor_accessible_company_ids SECURITY DEFINER**: 元 spec §14.2 サンプルは無 SECURITY DEFINER だったが、vendor_user 権限から呼ぶと vendors RLS で 0 行になる。SECURITY DEFINER + REVOKE FROM anon + GRANT TO authenticated が正解
3. **PoC test 削除 vs skip**: describe.skip 内に top-level await があり syntax error。削除を選択 (PoC は alpha-1 production code で置換済、historical reference 価値低)
4. **fresh-apply 保証**: live DB に直接 CREATE OR REPLACE しても `_raw_migrations.filename` を DELETE して再 apply しないと新環境で skip されて壊れる。advisor 指摘で発覚

## 次 Phase (Sprint α-1 Phase D 主作業 / E-2 拡張) 入力契約

### 最初に読むべきファイル (順)
1. `phase-handoff/phase-11-alpha-1-ED.md` (本ファイル)
2. `phase-handoff/sprint-alpha-1-plan.md` v1.1 (Phase D-2/D-3 + E-2 残)
3. `scripts/poc-3-run.ts` (outbox worker 実装パターン参考、`pit_v24_poc.notification_outbox` → `public.notification_outbox` 移植)
4. `tests/poc/poc-3-seed.sql` (fixture 構造参考)
5. `src/lib/inngest/client.ts` (D-1 boilerplate、functions 配列に追加先)

### 次の着手タスク (推奨順)
- **D-2 (Codex 委任)**: outbox-dispatcher Inngest function、PoC #3 のロジック (`FOR UPDATE SKIP LOCKED` + status='processing' + stale recovery) を Resend 送信器付きで移植
- **E-2 残 18 ケース (Claude/Codex)**: fixture builder (createTestCompany / createTestVehicle 等) を作って 6 tables × 3 actions を網羅
- **D-3 (Codex 委任)**: inbox-worker Inngest function、PoC #8 reflective INSERT 移植
- **DoD 残**: outbox-dispatcher 起動 + stale recovery 動作確認

### 並走可能
- D-2 と E-2 拡張は同時着手可能
- D-3 は D-2 完了後

### 絶対に壊してはいけないもの (invariants)
- helper 7 関数 (B-1a, B-1c, B-1d)、特に vendor_accessible_company_ids の SECURITY DEFINER (E-1 8/8 が依存)
- record_audit_log 関数 (`TG_OP IN (...)` 分岐、`NEW IS NOT NULL` に戻さない)
- 9 audit triggers (E-2 9/9 が依存)
- 51 RLS policies (system_settings は `read_all_authenticated` 特殊化保持)
- _raw_migrations の現状 (18 含む 22 件 applied)

## watchpoint 継承

- **CREATE FUNCTION の SECURITY DEFINER vs INVOKER 判断**: 関数が他テーブルを SELECT する場合、呼び出し元の RLS が阻害する可能性。helper / trigger 系は基本 SECURITY DEFINER + REVOKE FROM anon
- **destructure `const [foo] = await tx<...>` パターン**: TypeScript strict で `T | undefined`。`(await tx<...>)[0]!` パターンに統一
- **dynamic import postgres**: `TransactionSql` 型が unresolvable → `type Tx = any` (test 限定)
- **describe.skip ≠ top-level await containment**: skip 内に await が arrow body にあると syntax error
- **fresh apply 必須**: `mcp__supabase__execute_sql` で live DB に直接書いた場合は対応する SQL ファイルを更新 + `_raw_migrations.filename` DELETE → 再 apply

## Sprint α-1 DoD 達成状況

| DoD 項目 | 状態 |
|---|---|
| count(public.tables) >= 46 | ✅ (47 + matviews + 1 pii) |
| helper 7 関数 smoke test 緑 | ✅ (B-2) |
| RLS 漏洩 0 (E-1) | ✅ (8/8 PASS) |
| record_audit_log test matrix 27/27 緑 (E-2) | ⚠️ **9/27 (Tier 1-4 のみ)** |
| pii_anonymization_jobs state machine 1 ループ | ✅ (B-2) |
| outbox-dispatcher 起動 + stale recovery | ❌ **D-1 boilerplate のみ、D-2 未着手** |
| pnpm typecheck / lint 0 | ✅ typecheck (lint 別途) |
| roadmap.md line 95 文言修正 | ✅ |
| pnpm test 緑 | ✅ (18/18) |

**Sprint α-1 進捗: 7/9 DoD (78%)**。残 2 (E-2 拡張 + D-2 outbox)。

## Codex ledger refs

- E-2 Codex 1: vitest test ~248 行 (.codex-prompts/e-2-output.log)
- E-2 Codex 2 typecheck fix (broken parens 残存、Claude が replace_all で完成)
- E-1 Codex: vitest test ~143 行 (.codex-prompts/e-1-output.log)
- D-1 Codex: 2 files + package.json (.codex-prompts/d-1-output.log)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加テストファイル | 2 (record-audit-log / tenant-isolation) |
| 削除テストファイル | 2 (poc-02 / poc-13) |
| 追加 Inngest setup files | 2 (client.ts / route.ts) |
| 追加コード行数 | ~400 (test 2 + Inngest 2 + helper fix) |
| Codex 委任率 | ~85% (Codex E-1/E-2/D-1) |
| pnpm test | 18/18 PASS |
| pnpm typecheck | 緑 |
| セッション数 | 3 (前夜 B + 今朝 C + 今 ED) |

## 朝の進捗まとめ (2026-05-24 中盤)

- 09:30-10:00: Phase 10-C apply + smoke test + Phase C handoff
- 10:00-10:30: E-2 Codex 委任 + typecheck 修正 (replace_all で broken parens 修正) + 9/9 PASS
- 10:30-11:00: E-1 Codex 委任 + helper SECURITY DEFINER fix + 8/8 PASS
- 11:00-11:30: D-1 Codex + advisor 指摘対応 (`_raw_migrations` DELETE + fresh apply 確認) + PoC test cleanup + roadmap fix

---

*Generated by phase-handoff skill (seal mode) — Sprint α-1 78% DoD、D-2 + E-2 拡張で完走*
