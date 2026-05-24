# Phase 13-drift-audit: Schema Drift 全テーブル発見 + α-2 Reconciliation 切替 Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 境界 | Phase 12 sealed (α-1 主要 DoD + D-2/D-3 実装) → 本 Phase (D-2 動作確認 + 全テーブル drift audit) → Sprint α-2 (reconciliation) |
| 状態 | sealed (drift map 確定 / roadmap v1.2 切替 / risks R-H-000 記録) |
| 担当 | Claude (advisor / architect 二重 review、roadmap 改訂) + Codex (smoke / D-3 / drift audit / risks 編集) |
| 関連 commits | 615950c (D-2 fix + D-3 + smoke verified) + 本 Phase の roadmap/audit/risks/handoff (未 commit) |

## 本 Phase 達成事項

1. **D-2 動作確認完走** (cron 4 回観測 / claim batch / Resend 実送信 / status='sent' / sent_at 刻印 / stale recovery)
2. **D-2 schema 不整合 第 1 件発見・修正**: `notification_outbox.target_type` の channel/recipient 意味論逆 → dispatcher 側を `payload.channel` 判定に切替
3. **D-3 inbox-worker 実装** (Codex 委任 104 行、CTE + NOT EXISTS 冪等 reflective INSERT、client.ts 統合)
4. **build/typecheck/test 全緑** (pnpm test 36/36 / typecheck / build `/api/inngest` Dynamic に outbox+inbox 両 register)
5. **transport_orders schema 大規模 drift 発見** (movement_type 値域逆転 + 17 列欠落 + 関連子テーブル drift)
6. **advisor 逆指摘 → 全 22 ファイル drift audit 実施**: 18 テーブル drift / **critical 7 件** 確定
7. **drift map レポート保存**: `spec/audit/audit-schema-drift-2026-05-24.md` (126 行)
8. **roadmap v1.2 改訂**: α-2 を業者ループ縦切り → reconciliation sprint に切替、α-3 を業者ループ縦切り + 条件付き release に変更、進捗ダッシュボード更新
9. **risks R-H-000 (Schema Drift Incident) 記録**: 根本原因仮説 + 対応 + 恒久予防策

## 重要設計判断

1. **case B (DROP + recreate)** を α-2 reconciliation の基本戦略に採用 (architect + advisor 一致)。理由: 本番データ無し / movement_type 意味論置換が ALTER で 7 段階 vs DROP+recreate 1 段階 / spec v2.4 と 4 レーン監査 (Tier 1) は確定済で巻き戻し不可
2. **alpha-core 5/31 release を条件付きに格下げ**: critical 7 reconcile + 業者ループ最小動作で release 判断、未達なら 6/2+ slip (Claude の予測値は出さず事実条件のみ提示)
3. **dispatcher 修正は payload.channel 経由** (schema を触らない最小修正で α-1 sealed 整合を維持、本 Phase 内で commit)
4. **drift audit は spec/audit/ に専用ファイルとして残す**: 「E-2 緑 = schema 正しい」誤認の再発防止記録 (advisor 指摘 #2)
5. **R-H-000 を R-H-001 より前に配置**: 段取りくんで現存する最 high リスクは sprint slip より schema drift 連鎖

## 次 Phase (Sprint α-2 reconciliation) 入力契約

### 最初に読むべきファイル (順)
1. 本ファイル `phase-handoff/phase-13-drift-audit.md`
2. `spec/audit/audit-schema-drift-2026-05-24.md` (drift 全体像、critical 7 詳細)
3. `spec/roadmap/roadmap.md` v1.2 §1.4 (α-2 reconciliation タスク表)
4. `spec/roadmap/risks.md` R-H-000 (incident 経緯)
5. `spec/data-model.md` v2.4 §7.6-§7.6.2 / §9.1-§9.2 / §7.9-§7.11 / §8.2 (critical 7 仕様)
6. `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql` / `03_roles_statuses.sql` / `09_vendors.sql` / `13_notifications.sql` (修正対象)

### 着手タスク (推奨順、roadmap v1.2 §1.4)
1. **transport_orders DROP + recreate** (spec §7.6-§7.6.2 完全準拠、movement_type 値域置換 + 18 列追加 + §7.6.1 CHECK)
2. **transport_order_invitations / vendor_attempts** 列追加・CHECK 修正 (§7.9-§7.10.2)
3. **statuses + status_transitions** reconcile (domain→status_type、code→key 命名統一)
4. **notification_deliveries** 列追加 + channel/result CHECK (§8.2)
5. **vendor_selection_logs** selection_method/_reason CHECK 補完 (§7.11)
6. 関連 RLS policy 再生成 (vendor_portal_select/update GRANT 列リスト追従、data-model.md line 1502-1505)
7. E-2 fixtures 修正 (transport_orders 3 assertion + statuses / vendor 系の列名変更追従、27/27 PASS 維持)
8. Drizzle schema 再生成 (`pnpm db:generate` + 手修正)
9. high 11 件のうち α-3 必須分の絞り込み → risks.md に α-3 / β 繰越分明示
10. reconciliation 完了確認 (test / typecheck / build)

### 並走可能
- transport_orders + invitations + vendor_attempts (12_transport.sql 集約) は 1 委任で
- statuses 系 (03_roles_statuses.sql) は別委任で並列
- notification_deliveries (13_notifications.sql) は別委任で並列

### 絶対に壊してはいけないもの (invariants)
- helper 7 関数 (vendor_accessible_company_ids SECURITY DEFINER 等)
- record_audit_log 関数 + 9 audit triggers (E-2 fixtures は列名追従するが trigger 本体は無変更)
- 51 RLS policies の company_id 境界 (列名変更時の GRANT 文だけ書き換え)
- `src/lib/inngest/instance.ts` singleton / `client.ts` の inngestFunctions 配列
- D-2 dispatcher 修正 (payload.channel 経由) と D-3 inbox-worker 実装は維持
- commit 615950c の D-2/D-3 動作実績 (cron / claim / send / sent_at / stale recovery / reflective INSERT)

## watchpoint 継承

- **DROP CASCADE の連鎖**: `notification_outbox.transport_order_id` ON DELETE CASCADE / 関連 children のため、`transport_orders` DROP 時は cleanup 順序に注意 (data 無し前提だが念のため bench)
- **RLS GRANT UPDATE 列リスト厳密性**: data-model.md line 1502-1505 で GRANT 対象列が列挙、新 CREATE TABLE は exact match 必須
- **E-2 fixtures の列名変更**: tests/integration/record-audit-log.test.ts の transport_orders / statuses fixture が壊れる、テスト fixture も spec 一致で書き直す
- **drift audit 自体の維持**: 今後の Sprint 末で「sprint で触ったテーブル」を spec と再 audit。β で `scripts/drift-audit.ts` 自動化検討
- **spec cross-check 必須化**: 今後の migration 委任 prompt template に「spec §X.Y を 1 行ずつ照合し drift があれば中断」を必須化

## Sprint α-2 想定 DoD (roadmap v1.2 §1.4)

| DoD 項目 | α-2 末判定 |
|---|---|
| critical 7 件すべて spec 一致 | (α-2 で達成必須) |
| 関連 RLS policy 再生成 + GRANT 列一致 | (α-2 で達成必須) |
| E-2 record-audit-log 27/27 維持 | (α-2 で達成必須) |
| Drizzle schema 再生成 + typecheck 緑 | (α-2 で達成必須) |
| `pnpm test` 緑 / `pnpm build` 緑 | (α-2 で達成必須) |
| high 11 件 α-3 繰越分の risks.md 明示 | (α-2 で達成必須) |

## Codex ledger refs

- del-20260524-022420-710b: D-2 smoke script `scripts/d2-smoke.ts` 87 行
- del-20260524-024648-34e0: D-3 inbox-worker (auto-apply failure、再委任で reject 想定)
- del-20260524-???? (foreground): D-3 inbox-worker.ts 104 行 + client.ts 編集
- del-20260524-030653-34d3: 全 22 ファイル drift audit (18 テーブル drift / critical 7)
- del-20260524-031516-c9e3: drift report 保存 `spec/audit/audit-schema-drift-2026-05-24.md` 126 行
- del-20260524-031836-ee2c: risks.md R-H-000 追記 33 行差分

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 新規 Inngest functions | 1 (inboxWorker、D-2 outboxDispatcher と併せて 2) |
| 追加コード行数 | ~250 (inbox-worker 104 + d2-smoke 87 + d2-seed 25 + dispatcher 修正 5 + client.ts 編集) |
| 追加ドキュメント行数 | ~285 (audit-schema-drift 126 + risks R-H-000 33 + roadmap v1.2 diff ~50 + handoff phase-13 ~180) |
| Codex 委任率 | 100% (smoke / D-3 / drift audit / drift report / risks 編集すべて Codex) |
| pnpm test | 36/36 PASS 維持 |
| pnpm typecheck | 緑 |
| pnpm build | 緑 |
| smoke 実送信件数 | 1 通 (kamitaku@funct.jp に届いた D-2 smoke email) |
| drift 発見テーブル数 | 18 / critical 7 / high 11 / low 1 (合計 22 ファイル中) |
| advisor / architect call | 各 1 回 (case B + drift audit を提案) |

## 朝の進捗まとめ (2026-05-24 朝〜午後)

- 11:30-12:25: Phase 12 (α-1 主要 DoD + D-2 build + ESLint 未設定明示) sealed
- 02:30-02:45 UTC: D-2 動作確認実装 (smoke script Codex 委任 + dev server 起動 + cron 観測)
- 02:45 UTC: Resend 実送信成功 (kamitaku@funct.jp)
- 02:46 UTC: stale recovery 観測 (recovered:1)
- 02:50-03:00 UTC: D-3 inbox-worker Codex 委任 (1 回目失敗、2 回目成功)
- 03:05 UTC: commit 615950c
- 03:05-03:15 UTC: transport_orders drift 発見 → architect + advisor 二重 review
- 03:15-03:20 UTC: 全 22 ファイル drift audit Codex 委任 → 18 テーブル / critical 7 件確定
- 03:20-03:25 UTC: drift report 保存 + roadmap v1.2 改訂 + risks R-H-000 追記
- 03:25 UTC: 本 handoff seal

---

*Generated by phase-handoff skill (seal mode) — α-2 を reconciliation sprint に切替、alpha-core release 条件付き*
