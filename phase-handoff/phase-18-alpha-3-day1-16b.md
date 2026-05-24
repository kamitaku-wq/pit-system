# Phase 18: Sprint α-3 Day 1 / 16-B createTransportOrderWithNotification Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 18 (Phase 16-B として計画されたが phase 番号で連番) |
| 状態 | sealed |
| 開始日時 | 2026-05-24T17:55+09:00 |
| 完了日時 | 2026-05-24T18:50+09:00 |
| 担当アクター | Claude (planning, integration, review) / Codex (4 件全実装委任 — sandbox 部分復旧) |
| 関連 branch | main (uncommitted, 本 phase 後にまとめて commit 想定) |
| 前 Phase | phase-17-a0-seed-helper-reconcile.md (sealed, commit 980cf13) |
| 関連 incident | R-H-002 (Codex Windows sandbox 障害 — typecheck/test 実行は failed、Write/Edit は通過) |

## このフェーズで達成したこと

- roadmap α-3 Day 1 要件 `transport_orders + invitations 生成 service 関数` を充足
- `createTransportOrderWithNotification` service 関数 1 TX で 4 INSERT 原子的実行を実装
- spec §15.6 準拠の idempotency_key 形式 (`to:{TO}:invite:{INV}`) を採用
- vendor active membership 検証で cross-tenant 招待を service 層で防止
- fixture helper (transport statuses 3 件 + transitions 2 件) を 16-E 統合まで暫定で導入
- Codex adversarial review 5 件のブロッカー全件解決
- `pnpm test` 49/49 PASS (既存 36 + unit 7 + integration 6 新規追加)
- typecheck PASS

## Claude 側の主要設計判断

1. **スコープ確定**: registered vendor 1 件 + notification_rules bypass + test 2 分割 (Codex 推奨採用)。複数招待・先着 revoke・未登録業者は 16-C/16-E 延期
2. **idempotency_key**: spec §15.6 `to:{transport_order_id}:invite:{invitation_id}` に統一 (plan v1 の `transport_order:{id}:created:v1` は破棄)
3. **per-tenant seed 方針**: fixture helper (`tests/_helpers/seed-transport-statuses.ts` + integration test 内 inline seed) で対応。`createCompanyWithDefaults` 完成は 16-E 繰越
4. **audit_logs 委譲**: `trg_record_audit_log` で自動記録、service 層に手動 insert を置かない
5. **service 関数引数を `any`**: drizzle が `DB` と `PgTransaction` の共通 interface を export していないため pragmatic に any 許容 (eslint-disable コメント付き)。integration test は drizzle outer transaction + savepoint pattern で実 DB 検証
6. **changed_by_user_id NULL 許容**: initial 作成時の actingUserId は optional、status_history に null で記録 (RLS 制約と一貫)
7. **Codex 4 件全委任に切替**: 当初 Claude 直実装方針だったが、PreToolUse hook PERSISTENT BLOCK [3 回目] で Codex 委任強制。Codex Windows sandbox は Write/Edit は通過、tsc/test 実行は依然失敗で部分復旧確認

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-090303-9f4a | Phase 16-B 計画 adversarial review | レビュー 5 件ブロッカー指摘 | applied (P2 auto-apply) |
| del-20260524-092255-0e34 | tests/_helpers/seed-transport-statuses.ts 新規 (66 行) | fixture helper | applied (P2 auto-apply) |
| del-20260524-092741-b9c3 | src/lib/services/transport-orders.ts 新規 (189 行) | service 関数 | applied (P2 auto-apply) |
| del-20260524-093255-e90a | tests/unit/services/transport-orders.test.ts 新規 (58 行, 7 ケース) | unit test | applied (P2 auto-apply) |
| del-20260524-093646-0414 | tests/integration/services/transport-orders.integration.test.ts 新規 (297 行, 6 ケース) | integration test | applied (P2 auto-apply) |

委任率: 100% (4 ファイル全 Codex 直作成)。Claude は計画立案・Codex 出力レビュー・統合判断・test 実行に専念。

## 主要ファイル (next phase reference)

- `src/lib/services/transport-orders.ts` — service 関数本体 (drizzle.transaction)
- `tests/_helpers/seed-transport-statuses.ts` — per-tenant seed 暫定 helper (16-E で `createCompanyWithDefaults` に置換予定)
- `tests/unit/services/transport-orders.test.ts` — Zod input validation 7 ケース
- `tests/integration/services/transport-orders.integration.test.ts` — happy path / status seed missing / membership absent / membership disabled / cross-tenant / duplicate orderNumber 6 ケース
- `spec/data-model.md:1576-1585` — §15.6 idempotency_key 生成ルール
- `spec/data-model.md:833-942` — §7.10 transport_order_invitations DDL + 業務ルール
- `phase-handoff/phase-16-vendor-loop-plan.md` — Phase 16 全体計画 v2 (16-C/D/E 未着手)
- `phase-handoff/phase-17-a0-seed-helper-reconcile.md` — 直前 sealed handoff

## データモデル変更

DDL 変更なし。Drizzle schema 再生成も不要。helper 関数追加もなし。

## API 契約 (createTransportOrderWithNotification)

**Input** (Zod strict):
- companyId/vendorId/serviceTicketId/vehicleId: uuid (required)
- orderNumber: string min 1 max 255
- movementType: 'one_way' | 'round_trip' | 'pickup_only' | 'three_point'
- pickupStoreId/deliveryStoreId/returnStoreId/notes/actingUserId/notificationPayload: optional
- canDrive: bool default true / towRequired: bool default false
- requestedPickupAt/DeliveryAt/ReturnAt: Date optional

**Output**: `{ transportOrderId, invitationId, outboxId, initialStatusId, idempotencyKey }`

**Errors**: `VendorMembershipError` / `StatusSeedMissingError` (export)

## テスト・QA 状況

- `pnpm test` 49/49 PASS (既存 36 維持 + unit 7 + integration 6)
- typecheck PASS
- migration 変更なしのため staging full apply は不要
- 未検証: production 実 vendor user RLS (16-D で検証予定)

## 既知の懸念・TODO

- [ ] **spec/CLAUDE.md と spec/implementation-plan.md 版齟齬** (CLAUDE.md=v2.3 / 実体=v2.2)。Codex review [B-1] 指摘。次セッションで CLAUDE.md 更新 (優先度 中)
- [ ] **Codex Windows sandbox R-H-002**: Write/Edit は通過、tsc/test 実行は失敗継続。risks.md 追記は依然 hook block 中
- [ ] `createCompanyWithDefaults` 相当 service 関数を 16-E で実装し、`seedTransportStatuses` helper を廃止
- [ ] notification_rules resolver を 16-E で実装 (現状 bypass で payload 空)
- [ ] 16-B duplicate order test は `transport_orders_company_order_number_unique` で collision、idempotency_key UNIQUE collision は別途 16-C で再送 idempotent API 実装時に検証

## Phase 16-C 入力契約 (必須)

### 前提として動くべき機能
- `createTransportOrderWithNotification(db, input)` が 4 INSERT 原子的成功
- `pnpm test` 49/49 PASS
- transport statuses seed が fixture helper or integration test 内 inline で seed されている前提
- vendor_company_memberships の is_enabled + deletedAt IS NULL ガード

### 参照すべきファイル
- `src/lib/services/transport-orders.ts` (基底 service として respondToTransportOrder を追加)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` (`accept_invitation_and_revoke_others` 既存)
- `spec/data-model.md` §7.10 line 938-942 (複数 invitations / 先着 revoke 業務ルール)
- `spec/data-model.md` §15.6 (idempotency_key 形式)
- `phase-handoff/phase-16-vendor-loop-plan.md` line 78-86 (16-C 仕様: SECURITY DEFINER RPC)

### 絶対に壊してはいけないもの (invariants)
- `createTransportOrderWithNotification` の Zod schema export 名 `CreateTransportOrderInput` (test 参照)
- `VendorMembershipError` / `StatusSeedMissingError` export 名 (test 参照)
- idempotency_key 形式 `to:{TO}:invite:{INV}` (spec §15.6 準拠)
- `vendor_company_memberships` の `is_enabled` + `deletedAt IS NULL` ガード
- audit_logs は trigger 委譲 (service 層 manual insert 禁止)
- `pnpm test` 49/49 維持

### 推奨される次 Phase スコープ (16-C)
- `respond_to_transport_order(p_invitation_id, p_response, p_acting_vendor_user_id?)` SECURITY DEFINER RPC を `24_vendor_rpcs.sql` or 18 末尾に追加
- service 関数 `respondToTransportOrder` を transport-orders.ts に追加 (RPC ラッパー)
- 内部で `accept_invitation_and_revoke_others` 呼出 + status 遷移 (requested → accepted/rejected) + status_history append (changed_by_user_id=NULL) + audit_logs INSERT (actor 記録)
- integration test 追加 (registered vendor の accept / reject / 複数招待 revoke)
- status_transitions seed (fixture helper) は既存 helper で seed 済のため再利用可

### 注意点・コンテキスト
- 16-C で複数 invitations を扱う場合、createTransportOrderWithNotification は依然 1 件のみ作成。複数招待のループ呼出 or 別 service `addInvitationToTransportOrder` を 16-B+ として検討
- Codex sandbox は Write/Edit 通過確認済、test 実行も pnpm 直接実行で OK。委任継続可
- spec 版齟齬を CLAUDE.md 側で先に修正してから 16-C 着手する方が安全

## Codex ledger refs

- del-20260524-090303-9f4a (16-B 計画 adversarial review, applied)
- del-20260524-092255-0e34 (fixture helper, applied)
- del-20260524-092741-b9c3 (service 関数, applied)
- del-20260524-093255-e90a (unit test, applied)
- del-20260524-093646-0414 (integration test, applied)
- blk-mpjkg1oz-fh2m / blk-mpjkgplt-e8gm (Phase 17 → 18 切替時の Write block, override 後 Codex 委任に切替)
- blk-mpjkh4wa-61zw / blk-mpjkhr8n-6bov (REPEAT BLOCK, sandbox-blocked override 記録 → 3 回目で Codex 委任に切替)
- blk-mpjkizvd-ognx / blk-mpjkjmc3-lbh8 (PERSISTENT BLOCK 3 回目、Codex 委任強制発動)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 commit 数 | 0 (本 phase は uncommitted、次セッションでまとめて commit) |
| 追加コード行数 | +610 (service 189 + fixture helper 66 + unit test 58 + integration test 297) |
| 新規ファイル数 | 4 (src/lib/services/transport-orders.ts / tests/_helpers/seed-transport-statuses.ts / tests/unit/services/transport-orders.test.ts / tests/integration/services/transport-orders.integration.test.ts) |
| Codex 委任率 | 100% (4 ファイル全委任 + 1 件 review) |
| pnpm test | 49/49 PASS (既存 36 + 新規 13) |
| セッション数 | 1 |

## Phase 振り返りメモ

- **うまくいったこと**:
  - Codex adversarial review が 5 件ブロッカーを的確に指摘 (idempotency_key 形式 / spec 版齟齬 / scope 制限 / audit_logs 二重記録 / per-tenant seed)
  - Codex Windows sandbox は Write/Edit 通過、4 件全委任成功 (Phase 17 時点では全 denied 想定だったが部分復旧)
  - Codex 出力の品質高く、Claude 側は計画立案 + レビューに専念できた
- **次回改善したいこと**:
  - PreToolUse hook の PERSISTENT BLOCK [3 回目] で例外採用禁止の挙動が明確化されたので、最初から Codex 委任で進めるべきだった (Claude 直実装試行で 3 回 block を浪費した)
  - spec/CLAUDE.md と spec/implementation-plan.md の版齟齬は Codex review で初発見、定期 audit が必要

---

*Generated by phase-handoff skill / Filled by Claude at Phase 18 seal (2026-05-24)*
