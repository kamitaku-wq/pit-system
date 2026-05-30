# Phase 14: Sprint α-2 Schema Reconciliation Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 14 |
| 状態 | sealed |
| 開始日時 | 2026-05-24T03:30 UTC (Phase 13 直後) |
| 完了日時 | 2026-05-24T13:25 UTC |
| 担当アクター | Claude (planning / review / 判定) + Codex (実装 100% 委任) |
| 関連 branch | main (未 commit) |
| 関連 incident | R-H-000 Schema Drift Incident (Phase 13 で発火) |

## このフェーズで達成したこと

1. **critical 6 件 spec 完全一致** (transport_orders / transport_order_vendor_attempts / transport_order_invitations / vendor_selection_logs / statuses / notification_deliveries)
2. **status_transitions (high) も同時 reconcile** (12_transport.sql / 03_roles_statuses.sql / 13_notifications.sql の 3 ファイル全 DROP + recreate)
3. **19_rls_policies.sql 連鎖修正** (vendor_portal_update GRANT 列リスト spec §14.4 一致、51 policies の company_id 境界維持)
4. **Drizzle schema 7 ファイル再生成** (transport_orders.ts / invitations / vendor_attempts / selection_logs / statuses / status_transitions / notification_deliveries.ts)
5. **E-2 fixtures 修正** (tests/integration/record-audit-log.test.ts: transport_orders / statuses / invitations fixture spec 追従)
6. **検証全緑**: `pnpm test` 36/36 PASS (E-2 27/27 維持 + tenant-isolation 8/8 + poc-11 1/1) / `pnpm typecheck` 緑 / `pnpm build` 緑
7. **R-H-000 に α-2 完了報告 + α-3/β 繰越判定追記** (risks.md)
8. **vendor_sla_overrides は β 繰越判定** (audit §2.5 影響度判定で確定)

## Claude 側の主要設計判断

1. **case B (DROP + recreate) を T1-T4 全件で採用**: Phase 13 advisor + architect 一致の判断を継承。本番データ無し前提で ALTER の段階分けより 1 段で確定する方が安全。
2. **T1+T2+T5 を 1 委任に集約 (12_transport.sql)**: roadmap v1.2 §1.4 の「並走可能: 12_transport.sql 集約は 1 委任で」を実行。同一ファイル内 4 テーブル一括 reconcile で整合性確保。
3. **T8 → T7 順序変更**: タスク順序を Drizzle schema 再生成 → E-2 fixtures 修正に逆転。schema 確定後 fixtures を書く方が型エラー位置が明示される。
4. **vendor_selection_logs.company_id を spec 通り CASCADE に修正**: Codex は universal rule で RESTRICT 採用したが、spec §7.11 line 952 が明示的に CASCADE。spec 優先で 1 行 Edit。
5. **繰越判定 4/4/3 分割**: α-3 必須 (業者ループ最小動作必要) 4 件 / α-3 検討 (UX 上望ましい) 4 件 / β 繰越 3 件。判定はユーザー承認済み (option 1)。

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-???? | 12_transport.sql 全 4 テーブル reconcile | src/lib/db/raw-migrations/alpha-1-public/12_transport.sql | applied + Claude 1 行修正 |
| del-20260524-034433-2101 | 03_roles_statuses.sql statuses/status_transitions reconcile | 同ファイル | applied |
| del-20260524-035135-ffdf | 13_notifications.sql notification_deliveries reconcile | 同ファイル | applied |
| del-20260524-035722-41ba | 19_rls_policies.sql vendor_portal_update GRANT 追従 | 同ファイル | applied |
| del-20260524-040422-a5bf | Drizzle schema 7 ファイル再生成 | src/lib/db/schema/{7 files}.ts | applied |
| del-20260524-041413-a945 | E-2 fixtures spec 追従 (record-audit-log.test.ts) | tests/integration/record-audit-log.test.ts | applied |
| del-20260524-043118-960a | risks.md R-H-000 に α-2 結果 + 繰越判定追記 | spec/roadmap/risks.md | applied |

## 主要ファイル (next phase reference)

- `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql` — transport 系 4 テーブル spec §7.6/7.9/7.10/7.11 完全準拠
- `src/lib/db/raw-migrations/alpha-1-public/03_roles_statuses.sql` — statuses / status_transitions spec §9.1/9.2 準拠
- `src/lib/db/raw-migrations/alpha-1-public/13_notifications.sql` — notification_deliveries spec §8.2 準拠 (outbox / rules / portal_inbox は無変更)
- `src/lib/db/raw-migrations/alpha-1-public/19_rls_policies.sql` — vendor_portal_update GRANT 列リスト追従 (line 1502-1505 spec match)
- `src/lib/db/schema/{transport_orders,transport_order_invitations,transport_order_vendor_attempts,vendor_selection_logs,statuses,status_transitions,notification_deliveries}.ts` — Drizzle 再生成
- `tests/integration/record-audit-log.test.ts` — E-2 27/27 fixtures 更新版
- `spec/roadmap/risks.md` R-H-000 — α-2 完了報告 + 繰越判定

## データモデル変更

| Table | 主変更 | 詳細 |
|---|---|---|
| transport_orders | 18 列追加 / 7 列削除 / movement_type 値域置換 | self_drive/tow/carrier → one_way/round_trip/pickup_only/three_point。movement_pattern_check 追加。UNIQUE(company_id, order_number) |
| transport_order_vendor_attempts | attempt_no → attempt_seq、status → response、UNIQUE(transport_order_id, attempt_seq) | response CHECK 4 値、vendor_id NOT NULL |
| transport_order_invitations | invited_at NOT NULL DEFAULT now() / invitee_name / invitee_phone / bound_vendor_id 追加 | invitations_target_check + partial UNIQUE 3 種 |
| vendor_selection_logs | selected_vendor_id NOT NULL / selection_method/reason CHECK / vendor_snapshot_* / considered_vendor_ids[] | append-only (CHECK true placeholder) |
| statuses | domain/code/sort_order 削除、status_type CHECK / key / display_order / is_initial / is_active 追加 | UNIQUE(company_id, status_type, key) |
| status_transitions | required_permission → required_permission_key、status_type/required_role_key/triggers_notification 追加 | UNIQUE(company_id, status_type, from→to) |
| notification_deliveries | notification_outbox_id → outbox_id、status → result CHECK 6 値、error → error_message、delivered_at → sent_at | channel CHECK(email/portal/line/sms) |

## テスト・QA 状況

- 追加テスト: 0 件 (fixture のみ更新)
- カバレッジ: 36/36 PASS 維持 (E-2 27 + tenant-isolation 8 + poc-11 1)
- typecheck: 緑
- build: 緑、全 8 ページ生成
- 既知バグ: なし
- パフォーマンス: 影響なし (構造変更のみ)
- セキュリティ: RLS company_id 境界維持確認、vendor_portal_update GRANT 列リスト spec 一致

## 既知の懸念・TODO

- [ ] **α-3 必須 4 件**: vendors / vendor_company_memberships / notification_rules / transport_order_status_history を α-3 で reconcile (R-H-000 内追記済み)
- [ ] **α-3 検討 4 件**: vendor_service_areas / vendor_available_days / transport_order_change_logs / reservation_settings を α-3 スコープ判定
- [ ] **β 繰越 3 件**: vendor_sla_overrides / attachments / vendor_available_stores
- [ ] `vendor_selection_logs_no_update CHECK (true)` は append-only の placeholder (spec §7.11 line 968 通り)。実 trigger 化は β で検討
- [ ] commit 未実施。Phase 14 sealed と同時に commit 推奨

## Phase 15 (Sprint α-3) 入力契約

### 前提として動くべき機能
- D-2 outbox-dispatcher (Phase 12 commit 615959c) + D-3 inbox-worker
- E-2 record-audit-log 27/27 (新 schema 一致 fixtures)
- D-1/D-2 schema (transport_orders / statuses / notification_outbox 等)

### 最初に読むべきファイル
1. 本ファイル `phase-handoff/phase-14-alpha-2-reconciliation.md`
2. `spec/roadmap/roadmap.md` v1.2 §1.5 (α-3 業者ループ縦切り + 条件付き release)
3. `spec/roadmap/risks.md` R-H-000 α-3/β 繰越判定 (α-3 必須 4 件)
4. `spec/data-model.md` v2.4 §7.5 (vendors) / §7.5a (vendor_company_memberships) / §8.3 (notification_rules) / §7.7 (transport_order_status_history)

### 絶対に壊してはいけないもの (invariants)
- 12_transport.sql / 03_roles_statuses.sql / 13_notifications.sql の **α-2 reconcile 結果**
- 19_rls_policies.sql の 51 policies / vendor_portal_update GRANT 列リスト
- Drizzle schema 7 ファイル (T8 で再生成済み)
- E-2 27/27 + tenant-isolation 8/8 + poc-11 1/1
- D-2 dispatcher (payload.channel 経由) + D-3 inbox-worker
- helper 7 関数 / record_audit_log + 9 triggers / 51 RLS policies の company_id 境界
- inngest singleton (`src/lib/inngest/instance.ts`) / `client.ts` の inngestFunctions 配列

### 推奨される次 Phase スコープ
- **α-3 必須 4 件 reconcile** (vendors / vendor_company_memberships / notification_rules / transport_order_status_history) を最初に
- その後 **業者ループ最小実装** (transport_orders 作成 → notification_outbox INSERT → outbox dispatcher 送信 → inbox-worker reflective INSERT → 業者ポータル可視化)
- alpha-core 5/31 release 条件付き判定 (α-3 末で必須 4 件 + 業者ループ最小動作確認できれば release)

### 注意点
- migration 委任 prompt に「spec を 1 行ずつ照合」を必須化 (R-H-000 watchpoint)
- α-3 検討 4 件は業者ループ最小では不要、UX 余力次第で順次。β 繰越 3 件は手を出さない

## Codex ledger refs

- del-20260524-???? (T1+T2+T5: 12_transport.sql)
- del-20260524-034433-2101 (T3: 03_roles_statuses.sql)
- del-20260524-035135-ffdf (T4: 13_notifications.sql)
- del-20260524-035722-41ba (T6: 19_rls_policies.sql)
- del-20260524-040422-a5bf (T8: Drizzle schema 7 files)
- del-20260524-041413-a945 (T7: E-2 fixtures)
- del-20260524-043118-960a (T9: risks.md 追記)

`linked_block_id`: blk-mpja4yer-rxxb → del-20260524-043118-960a (risks.md 強制委任パス hook block)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 commit 数 | 0 (Phase 14 sealed 後に commit 予定) |
| 修正ファイル数 | 11 (raw-migrations 3 / RLS 1 / Drizzle schema 7 / fixtures 1 / risks.md 1 / 本 handoff 1) |
| 修正コード行数 | ~600 (12_transport ~210 / 03_roles_statuses ~56 / 13_notifications ~84 / 19_rls partial / 7 schemas / 1 test) |
| Codex 委任率 | 100% (8 委任すべて Codex、Claude は 1 行 Edit のみ) |
| Codex 自動 apply | 全 8 件 P2 自動適用、reject 0 件 |
| pnpm test | 36/36 PASS |
| pnpm typecheck | 緑 |
| pnpm build | 緑 (8/8 静的ページ生成) |
| 1 セッション内完了 | はい (Phase 14 開始から sealed まで連続) |

## Phase 振り返りメモ

- **うまくいったこと**: spec を真の源として 1 行ずつ照合する委任 prompt が drift 完全除去に直結。Codex auto-apply で 7 委任が手戻り無く完走。
- **次回改善したいこと**: 委任前に spec の該当 section を Codex に直接読ませる prompt 設計が安定。R-H-000 watchpoint「spec cross-check 必須化」が機能している証拠。

---

*Generated by phase-handoff skill (seal mode) — Sprint α-2 reconciliation sealed、α-3 業者ループ縦切りへ*
