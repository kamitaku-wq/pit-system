# Phase 15: Sprint α-3 必須 4 件 + reservation_status_history Reconcile Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 15 |
| 状態 | sealed |
| 開始日時 | 2026-05-24T13:30 UTC (Phase 14 直後 resume) |
| 完了日時 | 2026-05-24T15:10 UTC |
| 担当アクター | Claude (planning / review / 1 件 Edit) + Codex (実装 4 委任) |
| 関連 branch | main (未 commit) |
| 関連 incident | R-H-000 Schema Drift Incident — α-3 必須 4 件 reconcile + scope+1 |

## このフェーズで達成したこと

1. **α-3 必須 4 件 spec 完全一致**: vendors (§7.1) / vendor_company_memberships (§7.2) / notification_rules (§8.3) / transport_order_status_history (§7.7)
2. **scope+1: reservation_status_history も spec §6.3 完全一致** (§7.7 が「§6.3 同構造」と記載、§6.3 自体が drift していたため同時 reconcile)
3. **`enforce_membership_shared()` 関数を spec §7.2.1 通り書き換え** (vendors.is_shared 参照に変更)
4. **20_triggers.sql の append-only 化**: `trg_set_updated_at ON {reservation,transport_order}_status_history` の DROP/CREATE 計 4 箇所削除
5. **Drizzle schema 5 ファイル再生成** (vendors / vendor_company_memberships / notification_rules / transport_order_status_history / reservation_status_history)
6. **19_rls_policies.sql 修正不要を確認** (51 policies は company_id のみ参照、reconcile した詳細列に依存なし)
7. **検証全緑**: `pnpm test` 36/36 PASS (E-2 27/27 維持) / `pnpm typecheck` 緑 / `pnpm build` 緑 (8/8 ページ)
8. **R-H-000 に Phase 15 完了報告追記** (risks.md)

## Claude 側の主要設計判断

1. **option B (scope+1) 採用**: spec §7.7 が「§6.3 同構造」と書いており、§6.3 自体が現行と drift している矛盾を発見 → R-H-000 watchpoint (「spec を 1 行ずつ照合」) に最も忠実な対応として reservation_status_history も同時 reconcile (4 件 → 5 テーブル)。ユーザー option 1 承認済み。
2. **case B (DROP+recreate) 全件採用**: Phase 14 と同じ判断継承。本番データ無し前提で 1 段確定。
3. **5 status_history カラム共通**: `to_status_id NOT NULL ON DELETE RESTRICT` / `changed_by_user_id ON DELETE SET NULL` / `changed_at NOT NULL DEFAULT now()` / `updated_at` 削除 (append-only 化) / INDEX(parent_id, changed_at)。
4. **20_triggers.sql の関数本体は維持**: `set_updated_at()` 関数は他テーブル多数で使用中のため削除せず、trigger 4 箇所のみ削除。
5. **§11.3 append-only 保護はスコープ外**: spec §11.3 は audit_logs のみ対象、status_history への REVOKE は spec 範囲外と判定。

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-052342-eb4c | 09_vendors.sql + 20_triggers.sql enforce_membership_shared 書き換え | 2 ファイル | applied (P2 auto) |
| del-20260524-053237-580c | 13_notifications.sql notification_rules のみ reconcile | 1 ファイル | applied (P2 auto) |
| del-20260524-053731-f479 | 11_reservations + 12_transport + 20_triggers (status_history 2 + trg_set_updated_at 4 箇所削除) | 3 ファイル | applied (P2 auto) |
| del-20260524-054944-5122 | Drizzle schema 5 ファイル再生成 | 5 ファイル | applied (P2 auto) |

risks.md 追記は Claude が Edit (.md は強制委任対象外、Phase 14 と方針変更)

## 主要ファイル (next phase reference)

- `src/lib/db/raw-migrations/alpha-1-public/09_vendors.sql` — vendors §7.1 / vendor_company_memberships §7.2 完全準拠
- `src/lib/db/raw-migrations/alpha-1-public/11_reservations.sql` — reservation_status_history §6.3 完全準拠
- `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql` — transport_order_status_history §7.7 完全準拠 (他 Phase 14 reconcile テーブル無編集)
- `src/lib/db/raw-migrations/alpha-1-public/13_notifications.sql` — notification_rules §8.3 完全準拠 (Phase 14 reconcile 3 テーブル無編集)
- `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql` — enforce_membership_shared 書き換え + status_history trg_set_updated_at 4 箇所削除
- `src/lib/db/schema/{vendors,vendor_company_memberships,notification_rules,transport_order_status_history,reservation_status_history}.ts` — Drizzle 再生成
- `spec/roadmap/risks.md` R-H-000 — Phase 15 完了報告追記

## データモデル変更

| Table | 主変更 |
|---|---|
| vendors | code/contact_email/contact_phone/status enum 削除 → name/contact_person_name/email/phone/notification_method CHECK/is_shared/priority/is_active/display_order/notes/version 追加 |
| vendor_company_memberships | is_shared/starts_on/ends_on 削除 → is_enabled/contract_started_at/contract_ended_at 追加 |
| notification_rules | event_key/template_key 削除 → event_type/timing_minutes_offset/retry_after_minutes/max_reminders 追加、channel CHECK (email/portal/line/sms/both) 導入 |
| transport_order_status_history | status_id/created_by_user_id/created_at/updated_at 削除 → to_status_id NOT NULL/changed_by_user_id/changed_at 追加、append-only 化、INDEX(transport_order_id, changed_at) |
| reservation_status_history | 同上 (reservation_id 参照、INDEX(reservation_id, changed_at)) |

## 20_triggers.sql 変更

- `enforce_membership_shared()` 関数本体書き換え (vendors.is_shared を参照、自社 membership は常時許可、他社は is_shared=true 必須)
- DROP TRIGGER + CREATE TRIGGER ペア 4 箇所 (2 status_history × {冒頭 DROP, 末尾 CREATE}) を削除

## テスト・QA 状況

- 追加テスト: 0 件
- カバレッジ: 36/36 PASS 維持 (E-2 27 + tenant-isolation 8 + poc-11 1)
- typecheck: 緑
- build: 緑、全 8 ページ生成
- 既知バグ: なし
- パフォーマンス: 影響なし (構造変更のみ)
- セキュリティ: RLS 51 policies は company_id のみ参照、reconcile した詳細列に依存なし → 修正不要を確認

## 既知の懸念・TODO

- [ ] **α-3 検討 4 件**: vendor_service_areas / vendor_available_days / transport_order_change_logs / reservation_settings を業者ループ最小実装後にスコープ判定
- [ ] **β 繰越 3 件**: vendor_sla_overrides / attachments / vendor_available_stores
- [ ] commit 未実施。Phase 15 sealed と同時に commit 推奨
- [ ] **業者ループ最小実装が未着手**: alpha-core 5/31 release 条件付き判定 (α-3 末で必須 4 件完了 ✓ + 業者ループ最小動作確認できれば release)

## Phase 16 (業者ループ最小実装) 入力契約

### 前提として動くべき機能
- α-2 + α-3 reconcile 結果すべて (12_transport / 03_roles_statuses / 13_notifications / 09_vendors / 11_reservations / 20_triggers)
- D-2 outbox-dispatcher (Phase 12) + D-3 inbox-worker
- E-2 record-audit-log 27/27 (新 schema fixtures)

### 最初に読むべきファイル
1. 本ファイル `phase-handoff/phase-15-alpha-3-reconciliation.md`
2. `spec/roadmap/roadmap.md` v1.2 §1.5 (α-3 業者ループ縦切り + 条件付き release)
3. `spec/data-model.md` v2.4 §7.6 (transport_orders) / §8.1 (notification_outbox) / §8.4 (vendor_portal_inbox)
4. `spec/implementation-plan.md` v2.3 (Phase 2 縦切り service 関数群)

### 絶対に壊してはいけないもの (invariants)
- α-2 reconcile 結果 (12_transport / 03_roles_statuses / 13_notifications) — Phase 14 確定
- α-3 reconcile 結果 (09_vendors / 11_reservations / 13_notifications notification_rules / 12_transport status_history / 20_triggers) — 本 Phase 確定
- Drizzle schema 12 ファイル (Phase 14 で 7 ファイル + Phase 15 で 5 ファイル再生成済み)
- 19_rls_policies.sql 51 policies / vendor_portal_update GRANT 列リスト
- E-2 27/27 + tenant-isolation 8/8 + poc-11 1/1 = 36/36 PASS 維持
- D-2 dispatcher (payload.channel 経由) + D-3 inbox-worker
- helper 7 関数 / record_audit_log + 9 triggers / inngest singleton

### 推奨される次 Phase スコープ
- **業者ループ最小実装** (transport_orders 作成 → notification_outbox INSERT → outbox dispatcher 送信 → inbox-worker reflective INSERT → 業者ポータル可視化 → 業者対応可否レスポンス)
- alpha-core 5/31 release 条件付き判定 (業者ループ最小動作確認できれば release)
- α-3 検討 4 件は業者ループ実装中に必要性が判明したら reconcile、不要なら β 繰越

### 注意点
- migration 委任 prompt に「spec §X.Y を 1 行ずつ照合」必須 (R-H-000 watchpoint 継続)
- transport_order_invitations / vendor_selection_logs (Phase 14 reconcile 済み) との連携で業者ループの先着受注ロジック検証
- accept_invitation_and_revoke_others DB 関数 (ADR-0008) の実装是非を確認

## Codex ledger refs

- del-20260524-052342-eb4c (T1: 09_vendors + 20_triggers enforce_membership_shared)
- del-20260524-053237-580c (T2: 13_notifications notification_rules)
- del-20260524-053731-f479 (T3: 11_reservations + 12_transport status_history + 20_triggers trg_set_updated_at 削除)
- del-20260524-054944-5122 (T4: Drizzle schema 5 files)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 commit 数 | 0 (Phase 15 sealed 後に commit 予定) |
| 修正ファイル数 | 12 (raw-migrations 5 / Drizzle schema 5 / risks.md 1 / 本 handoff 1) |
| 修正コード行数 | ~150 (5 SQL 部分修正 + Drizzle 5 ファイル全面 + risks 追記) |
| Codex 委任率 | 4/4 SQL/Drizzle 委任 100%、Claude は risks.md (.md 強制委任対象外) のみ Edit |
| Codex 自動 apply | 全 4 件 P2 自動適用、reject 0 件 |
| pnpm test | 36/36 PASS |
| pnpm typecheck | 緑 |
| pnpm build | 緑 (8/8 静的ページ) |
| 1 セッション内完了 | はい (Phase 14 sealed 直後 resume → Phase 15 sealed まで連続) |

## Phase 振り返りメモ

- **うまくいったこと**: T0 diff 把握フェーズで reservation_status_history drift を発見できた (spec §7.7 が「§6.3 と同構造」と書いてあるところを 1 行ずつ照合した結果)。R-H-000 watchpoint が機能している。
- **次回改善**: status_history 系は元から append-only 設計であるべきだったが Phase 8 時点で updated_at + trg_set_updated_at が誤って追加されていた。今後の append-only テーブル委任 prompt に「updated_at 不要 / set_updated_at trigger 不要」を明記すると drift 予防になる。

---

*Generated by phase-handoff skill (seal mode) — Sprint α-3 必須 4 件 + scope+1 reconcile sealed、Phase 16 業者ループ最小実装へ*
