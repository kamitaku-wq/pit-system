# Phase 17: 16-A0 seed/helper drift reconcile Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 17 (Phase 16 sub-phase A0 を独立 phase として seal) |
| 状態 | sealed |
| 開始日時 | 2026-05-24T17:00+09:00 |
| 完了日時 | 2026-05-24T17:55+09:00 |
| 担当アクター | Claude (planning, audit, implementation, verify) / Codex sandbox 失敗のため委任実施せず |
| 関連 branch | main (uncommitted) |
| 関連 incident | R-H-000 (spec/roadmap/risks.md), R-H-002 (Codex sandbox 障害) |

## このフェーズで達成したこと

- R-H-000 watchpoint 履行: Phase 14/15 reconcile 後に残存していた seed/helper drift 6 件を全件発見・修正
- `21_seed_master.sql` から spec §18.1 違反の per-tenant INSERT (statuses/status_transitions/notification_rules) を **完全削除** (81 → 31 行)
- `18_helper_functions.sql` の 3 関数を現行 DDL と spec §7.10.2 に整合 (vendor_accessible_company_ids / vendor_invited_transport_order_ids / accept_invitation_and_revoke_others)
- helper 冒頭 deviation コメントを Phase 15 reconcile 後の現実 (`is_enabled` + `contract_*_at`) と Phase 16-A0 修正 (invitations 無 deleted_at) に整合
- `pnpm test` 36/36 PASS 維持 (tenant-isolation 8/8 含む)
- Codex Windows sandbox 障害 (R-H-002) を実地確認・delegation ledger override に `sandbox-blocked` 記録

## Claude 側の主要設計判断

1. **per-tenant seed の方針**: 21_seed_master から statuses/status_transitions/notification_rules を **完全削除** し、spec §18.1 通り「会社作成 service 関数で auto-seed」に委ねる。代替案 (テスト用 demo company を seed で先行作成し紐付け) は (a) テスト fixtures が既に seed bypass している (b) Phase 16-B で service 関数を実装する流れに合わない、で棄却
2. **invitations DDL に列追加せず helper を spec 準拠化**: spec §7.10.2 line 881-933 に `deleted_at/bound_at/updated_at` は無いため、DDL を変えず helper を縮める。spec ADR-0008 とも整合
3. **accept_invitation_and_revoke_others シグネチャ維持**: spec は 2 引数 `(p_invitation_id, p_acting_vendor_user_id)` だが、現状の 1 引数 + `current_vendor_user_id()` 経由が ADR-0008「service 関数は薄い wrapper」と整合するため維持。spec line 914 の `bound_vendor_id = v_invite_vendor_id` SET だけ取り込み
4. **lane_types/roles seed 現状維持**: 現行 DDL audit で `company_id` NULLABLE + 列名 (`sort_order`/`code`/`name`/`is_system`) 一致確認、drift なし
5. **検証は pnpm test 36/36 で fold**: Phase 14/15 と同じ方針。空 DB full apply は staging で別途実施 (今 phase scope 外)

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-082947-58e8 | Phase 16-A0 drift reconcile 全件 | (なし) | **rejected: sandbox-blocked** |

Codex Windows sandbox `spawn setup refresh` 失敗で全 tool call denied。Claude が直実装に切替 (override reason: `sandbox-blocked`)。

## 主要ファイル (next phase reference)

- `src/lib/db/raw-migrations/alpha-1-public/21_seed_master.sql` — system-global seed のみ (lane_types 6 + roles 6)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:51-68` — `vendor_accessible_company_ids` (新列名整合)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:72-79` — `vendor_invited_transport_order_ids` (deleted_at 削除)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:151-238` — `accept_invitation_and_revoke_others` (spec §7.10.2 整合)
- `spec/data-model.md:833-942` — transport_order_invitations §7.10 (helper 真理表)
- `spec/data-model.md:1113-1150` — statuses/status_transitions §9 (per-tenant 確定根拠)
- `spec/data-model.md:1738-1745` — §18.1 新規 company 自動シード方針
- `phase-handoff/phase-16-vendor-loop-plan.md` — Phase 16 全体計画 v2

## データモデル変更

DDL 変更なし。helper 関数と seed のみ修正。Drizzle schema 再生成も不要 (関数定義は schema.ts に含まれない)。

## API 契約

変更なし。`accept_invitation_and_revoke_others(uuid)` シグネチャ維持。

## テスト・QA 状況

- `pnpm test` 36/36 PASS (E-2 27/27 + tenant-isolation 8/8 + poc-11 1/1)
- 追加テストなし (drift 修正のみ)
- migration full apply は staging で別途検証必要
- 既知バグ: なし

## 既知の懸念・TODO

- [ ] **risks.md R-H-000 追記が hook PERSISTENT BLOCK で未完了** (本 handoff 文面が代替記録)。次セッションで Codex sandbox 復旧後 `/codex:rescue` 経由で追記、または hook policy 例外解除
- [ ] 16-B 着手前に **per-tenant seed service 関数** (`createCompanyWithDefaults` 相当) を設計する必要あり (spec §18.1)。statuses/status_transitions/notification_rules/reservation_settings/lane_types の標準値テンプレを TS 側で持つ
- [ ] テスト fixtures (record-audit-log.test.ts 等) が seed bypass で独自 INSERT してるが、per-tenant seed service 関数完成後はそれ経由に統一すべき (Phase 16-B 検討)
- [ ] `accept_invitation_and_revoke_others` シグネチャが spec と異なる (1 引数 vs 2 引数) のは ADR-0008 と整合する設計判断だが、spec 側も `current_vendor_user_id()` 経由を明記すべき (spec 改訂提案、優先度 low)

## Phase 16-B 入力契約 (必須)

### 前提として動くべき機能
- `vendor_accessible_company_ids(vendor_id)` が tenant-isolation test で PASS (確認済)
- `accept_invitation_and_revoke_others(uuid)` が compile-time SQL 整合 (実行時 smoke は 16-C で初検証)
- 21_seed_master の roles/lane_types が空 DB apply 成功

### 参照すべきファイル
- `phase-handoff/phase-16-vendor-loop-plan.md` — 16-B/C/D/E 仕様
- `spec/data-model.md` §7.10 (line 833-942) — invitations + accept 関数 真理表
- `spec/implementation-plan.md` v2.3 — service 関数 責務
- `spec/roadmap/roadmap.md` v1.1 line 159 — α-3 Day 1 要件 (`transport_orders + invitations 生成 service 関数`)

### 絶対に壊してはいけないもの (invariants)
- `transport_order_invitations` に `deleted_at/bound_at/updated_at` 列を追加しない (helper が前提)
- `vendor_company_memberships` の `is_enabled` + `contract_*_at` 列名 (Phase 15 reconcile 後固定)
- helper SECURITY DEFINER + `current_vendor_user_id()` 経由の認可ガード (16-C RPC も同方式)
- 21_seed_master を per-tenant 用に戻さない (構造的に不可能)
- `pnpm test` 36/36 維持 (新規テスト追加時も既存 36 を壊さない)

### 推奨される次 Phase スコープ (16-B)
- `src/lib/services/transport-orders.ts` 新規 `createTransportOrderWithNotification` 実装
- `transport_order + status_history + invitation 1件 + outbox` を 1 TX で原子的生成
- unit test `tests/unit/services/transport-orders.test.ts` 新規
- idempotency_key 仕様は spec で再照合 (plan v1 の `transport_order:{id}:created:v1` は要確認)
- per-tenant seed service 関数の **最小スタブ** を先行作成 (statuses + status_transitions だけ、test fixture 共用前提)

### 注意点・コンテキスト
- 16-B は Codex sandbox 復旧前提で計画されているが、Windows sandbox が引き続き fail する場合は Claude 直実装 + sandbox-blocked override で進める (Phase 17 と同パターン)
- accept_invitation_and_revoke_others シグネチャの spec 不一致は意図的設計、16-C RPC 実装時に spec 改訂提案を別途検討

## Codex ledger refs

- del-20260524-082947-58e8 (Phase 16-A0 全面 reconcile, rejected: sandbox-blocked)
- blk-mpjj3hty-n8h2 / blk-mpjj4mji-9brk / blk-mpjj6pmb-wh38 (risks.md Edit 3 連続 block, PERSISTENT)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 commit 数 | 0 (本 phase は uncommitted、次セッションでまとめて commit) |
| 追加コード行数 | -50 (21_seed_master 縮小) + ~10 (helper 修正 net) |
| 修正ファイル数 | 3 (21_seed_master.sql / 18_helper_functions.sql / phase-handoff 新規) |
| Codex 委任率 | 0% (sandbox 障害で全 Claude 直実装) |
| セッション数 | 1 |

## Phase 振り返りメモ

- **うまくいったこと**: spec 1 行ずつ照合 + DDL audit 並列 read で drift 6 件を 30 分以内に全件特定
- **次回改善したいこと**: Codex sandbox 障害時の hook PERSISTENT BLOCK 回避策が無く、ドキュメント追記まで止まる構造。hook policy で `.md` 拡張子の docs path 判定を強化、または `spec/roadmap/risks.md` を明示的に bypass path に追加すべき (`~/.claude/hooks/codex-delegate-reminder.js` の bypass パターン追加提案)

---

*Generated by phase-handoff skill / Filled by Claude at Phase 17 seal (2026-05-24)*
