# Phase 47 計画: §1.5 cancel action (Codex review 反映改訂版)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 47 (前: 46 sealed) |
| 状態 | **planning (Codex review 反映改訂版)** |
| 起源 | Phase 46 handoff 推奨 #1。Codex adversarial review (`.tmp/codex-review-phase47-output.md`) で NO-GO 判定 → BLOCK 2 / WARN 5 採用反映 |
| Branch | `phase-42-t4-test-coverage` (Phase 46 commit `490caf3` から +1 予定) |

## Codex review 採否

| 種別 | # | 内容 | 採否 |
|---|---|---|---|
| BLOCK | 1 | `target_type='vendor_invitation'` 新規 → DB CHECK + worker 契約に未整合 | **採用** → ALT 2 採択 (`target_type='vendor'` 維持) |
| BLOCK | 2 | `pending` のみ revoke は cancel/accept race で取りこぼし、spec §532「全 invitations を revoke」と乖離 | **採用** → 全 invitation (pending + accepted) を revoke + accept 側にも terminal guard 追加 |
| WARN | 1 | terminal を hard-coded (`cancelled/completed`) でなく `statuses.isTerminal` から引く | **採用** |
| WARN | 2 | `change_type` 後回し方針を明示しないと planner 誤判定 | **採用** → handoff invariant 明記 |
| WARN | 3 | `expectedVersion` fail 時 not_found / stale / terminal で原因分岐 | **採用** |
| WARN | 4 | test に race / idempotency 衝突再実行 case 追加 | **採用** → 7-9 件 → 12 件に拡張 |
| WARN | 5 | `reason` 長さ根拠薄 + PII マスク方針未定 | **部分採用** → 上限 1000 文字、PII redaction は Phase 45 last_error 共通課題に統合 (handoff invariant) |
| INFO | 1 | 1 transaction 4 副作用は妥当 | 採用 |
| INFO | 2 | inline form + confirm dialog は妥当 | 採用 |
| ALT | 1 | invitation 単位 N 件 → 1 件 order-level outbox + payload | **採用** → 既存 `to:{toId}:invite:{invId}` pattern と semantic 揃え `to:{toId}:cancelled:v{version}` (spec §1583 準拠) |
| ALT | 2 | `target_type='vendor'` 維持 + payload で invitation 識別 | **採用** → target_id = transport_orders.vendor_id (NOT NULL FK、既存 pattern と同じ) |

## scope IN / OUT 表 (改訂後)

### IN (副作用 5 系統、5 件目を新規追加)

| # | 副作用 | 詳細 |
|---|---|---|
| 1 | `transport_orders` UPDATE | WHERE `id=? AND company_id=? AND version=? AND deleted_at IS NULL`、SET `status_id='cancelled' status.id`, `cancelled_at=now()`, `version=version+1`, `updated_at=now()`。影響行 0 件 → 原因分岐 SELECT |
| 2 | `transport_order_status_history` INSERT 1 件 | from_status_id (current), to_status_id (cancelled), changed_by_user_id, reason (optional, max 1000 chars) |
| 3 | `transport_order_invitations` UPDATE 一括 | WHERE `transport_order_id=? AND response IN ('pending','accepted')` → SET `response='revoked'`, `responded_at=now()`, `updated_at=now()`、RETURNING invitation row for payload |
| 4 | `notification_outbox` INSERT **1 件 order-level** | target_type='vendor', target_id=transport_orders.vendor_id, event_type='transport_order.cancelled', idempotency_key='to:{toId}:cancelled:v{newVersion}', payload={ transportOrderId, cancelledAt, reason, revokedInvitations: [{ invitationId, vendorId, inviteeEmail, responseBefore }] } |
| 5 | `respondToTransportOrder` 修正 (新規追加) | 既存関数に「transport_order.status_id が cancelled (or isTerminal) なら `StatusTransitionError` throw」guard 追加 (1-2 行) |

### IN (基盤)

- `tests/_helpers/seed-transport-statuses.ts` 拡張: `cancelled` key 追加 (isTerminal=true, isInitial=false)
- `status_transitions` seed 追加: `accepted→cancelled` / `requested→cancelled` / `rejected→cancelled` 3 件
- terminal 判定は `statuses.isTerminal=true` を引く (hard-coded 禁止)
- expectedVersion fail 時 SELECT で原因特定 → 適切な error class:
  - 該当 row 0 件 + companyId 一致 row も 0 件: `TransportOrderNotFoundError` (cross-tenant 含む、leak 防止)
  - row 存在 + status_id=cancelled: `AlreadyCancelledError`
  - row 存在 + isTerminal=true (cancelled 以外): `TerminalStatusCancelError`
  - row 存在 + version 不一致: `ConcurrentTransportOrderCancelError`
- detail page に「キャンセル」button + inline confirm form + reason input
- server action: `cancelTransportOrderAction(formData)`, `getAdminUser()` 再認証 (Phase 45 W5 pattern)

### OUT (handoff invariant 明記、後続 Phase 課題)

- **Worker 側 `transport_order.cancelled` event handler** (payload.revokedInvitations 展開して N 通通知メール送信) — 本 Phase は outbox row 1 件作成までで停止
- **production status seed 経路 (`createCompanyWithDefaults`)** — pre-launch MVP blocker、別 Phase
- **関連 reservation cancel 遷移** — reservation service 自体未実装、別 Phase
- **status_history.change_type column 追加 migration** — spec/data-model.md §3.11 言及あるが現状 schema 未存在、別 Phase
- **reason PII redaction** — Phase 45 §1.8 last_error 共通課題に統合

## 主要設計判断 (改訂)

1. **副作用 5 系統 (順序固定 1→2→3→4→5)** を 1 drizzle transaction で包む (原子性必須)
2. **outbox 1 件 order-level** (ALT 1): `target_type='vendor'`, `target_id=transport_orders.vendor_id`, payload に revoked invitations 配列。worker 側で展開する責務に分離
3. **全 invitation revoke (pending + accepted)** (BLOCK 2 採用): spec §532 整合、race condition 緩和
4. **`respondToTransportOrder` に terminal guard 追加** (BLOCK 2 補完): cancel が先に commit、accept が後の race で `StatusTransitionError` throw
5. **terminal 判定は `statuses.isTerminal`** (WARN 1): hard-coded 禁止、status table が真実の源
6. **idempotency_key に `v{newVersion}` 含む** (再 cancel 防止 + spec §1583 準拠): 同一 transport_order を再 cancel する場合 newVersion が異なるため UNIQUE 衝突回避、ただし terminal guard で先に block されるはず
7. **expectedVersion fail 時 4 way 分岐** (WARN 3): UX + 再試行性確保
8. **reason 1000 文字、PII は別 Phase** (WARN 5 部分採用): 監査用途に短すぎ防止、PII redaction は Phase 45 last_error 共通課題に統合
9. **change_type なし** (WARN 2): from/to/reason/changed_by で十分、change_type 追加 migration は別 Phase
10. **inline form + confirm dialog** (INFO 2): 別 page 不要、Phase 46 page 拡張で完結

## service 関数シグネチャ案 (改訂)

```ts
export const CancelTransportOrderInput = z.object({
  transportOrderId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().max(1000).optional(),
});
export type CancelTransportOrderInput = z.input<typeof CancelTransportOrderInput>;

export interface CancelTransportOrderResult {
  transportOrderId: string;
  newVersion: number;
  cancelledAt: Date;
  revokedInvitationIds: string[];
  notificationOutboxId: string;
  idempotencyKey: string;
}

export class ConcurrentTransportOrderCancelError extends Error {}
export class AlreadyCancelledError extends Error {}
export class TerminalStatusCancelError extends Error {}
export class TransportOrderNotFoundError extends Error {}
export class CancelStatusSeedMissingError extends Error {}

export async function cancelTransportOrder(
  database: typeof db,
  companyId: string,
  userId: string,
  input: CancelTransportOrderInput,
): Promise<CancelTransportOrderResult>;
```

`respondToTransportOrder` 既存関数に guard 追加 (差分):
```ts
// 既存の invitation fetch 後、transport_order の status を check
const orderRow = await tx.execute(sql`
  SELECT t.id, t.status_id, s.is_terminal, s.key
  FROM transport_orders t
  JOIN statuses s ON s.id = t.status_id
  WHERE t.id = ${transportOrderId} AND t.company_id = ${companyId}
`);
const order = orderRow.rows[0];
if (order && (order.key === 'cancelled' || order.is_terminal === true)) {
  throw new StatusTransitionError(`cannot respond to ${order.key} transport order`);
}
```

## integration test 案 (12 件)

1. happy path: cancel 成功 (status='cancelled', cancelled_at set, version+1, invitations revoke, outbox 1 件)
2. version conflict: `ConcurrentTransportOrderCancelError`
3. already cancelled: `AlreadyCancelledError`
4. terminal (isTerminal=true 他 status): `TerminalStatusCancelError`
5. cross-tenant: `TransportOrderNotFoundError` (leak しない)
6. soft-deleted: `TransportOrderNotFoundError`
7. cancelled status seed 不在: `CancelStatusSeedMissingError`
8. no invitation: revokedInvitationIds=[], outbox 1 件 (payload.revokedInvitations=[])
9. **accept race (accept が先 → cancel が後)**: accepted invitation も revoked、outbox payload.revokedInvitations に含む
10. **accept race (cancel が先 → accept が後)**: `respondToTransportOrder` で `StatusTransitionError`
11. status_history append: 1 件追加、from/to/changedBy/reason 正しい
12. **並行 cancel 2 件**: 1 件成功、1 件 `ConcurrentTransportOrderCancelError`

## Codex 委任プラン (改訂)

| Task | 委任先 | 規模 |
|---|---|---|
| T1 service `cancelTransportOrder` + 5 error class + `respondToTransportOrder` guard 追加 + test seed 拡張 (cancelled status + transitions seed) | `codex:codex-rescue` --effort high | 中 (約 200-250 行) |
| T2 detail page 拡張 + server action 新規 | `codex:codex-rescue` --effort high | 小〜中 (約 80-120 行) |
| T3 integration test 12 件 (race / concurrent 含む) | `codex:codex-rescue` --effort high | 中 (約 350-450 行) |

T1/T2/T3 並列可。委任プロンプトに以下を明記:
- **「直近 handoff (phase-46-sealed) の持ち越し item を読み込み、新規コードで regression させない (例: `isNaN` → `Number.isNaN`、Number 系 utility は既存 `expectNumber` 流用)」**
- **「target_type='vendor', target_id=transport_orders.vendor_id (既存 createTransportOrderWithNotification と同じ pattern)」**
- **「terminal 判定は `statuses.isTerminal` を引く、hard-coded 禁止」**
- **「全 invitation (pending + accepted) を revoke、`response IN ('pending','accepted')` 条件」**
- **「`respondToTransportOrder` 既存関数に terminal/cancelled guard 追加 (差分は最小、既存 test 壊さない)」**

## handoff 必須記載項目 (sealed 時)

- **MVP blocker 1**: cancel action は本番で `cancelled` status seed 経路整備後でないと動作しない (`CancelStatusSeedMissingError` throw)
- **MVP blocker 2**: 関連 reservation の cancel 遷移は別 Phase (reservation service 自体未実装)
- **MVP blocker 3**: worker 側 `transport_order.cancelled` event handler 未実装 (outbox row 1 件作成までで停止、payload 展開 N 通送信は worker enhancement 別 Phase)
- **MVP blocker 4**: status_history.change_type column 追加 migration 未実施 (spec §3.11 言及あるが schema 未存在)
- **invariants (Phase 47 確定)**:
  - `cancelTransportOrder` semantic (5 副作用 1 transaction 包) 破壊禁止
  - outbox idempotency_key pattern `to:{toId}:cancelled:v{version}` 維持
  - `respondToTransportOrder` の terminal guard 維持 (cancel/accept race 防止)
  - target_type='vendor' / target_id=transport_orders.vendor_id 維持
  - 全 invitation revoke (pending + accepted) 維持 (spec §532 整合)

## 主要参照ファイル

- `phase-handoff/phase-46-transport-order-detail-sealed.md` (前 Phase)
- `.tmp/codex-review-phase47-output.md` (Codex review 全文、改訂根拠)
- `src/lib/services/transport-orders.ts` lines 65-194 (createTransportOrderWithNotification outbox pattern) / lines 266-330 (respondToTransportOrder guard 追加対象)
- `src/lib/services/admin-vendor-invitations.ts` lines 196-215 (outbox INSERT pattern)
- `src/app/admin/transport-orders/[id]/page.tsx` (Phase 46 detail page base 318 行)
- `src/app/admin/notifications/actions.ts` (Phase 45 server action pattern 28 行)
- `tests/_helpers/seed-transport-statuses.ts` (拡張対象、`cancelled` key + 3 transitions)
- `src/lib/db/schema/transport_orders.ts` / `transport_order_status_history.ts` / `transport_order_invitations.ts` / `statuses.ts`
- `src/lib/db/schema/notification_outbox.ts` (idempotency_key UNIQUE / target_type CHECK 整合確認済)
- spec/requirements.md §527 / §532 / §665 (cancel semantic)
- spec/data-model.md §3.11 / §8.1 / §1583 (status_history / notification_outbox / idempotency_key pattern)

## 注意点・コンテキスト

- Phase 46 累積 fix 15 件すべてに retrogression なし維持
- typecheck clean / unit 35 / integration 101 PASS 維持 → Phase 47 で integration +12 件で 113 PASS 目標
- Codex adversarial review 5 回目 (NO-GO → 改訂版で GO 想定)、再 review 省略 (BLOCK 全採用済み)
- Codex 委任プロンプトに「Number.isNaN 使用、isNaN 禁止」 + 「直近 handoff 持ち越し item 確認」明記 (Phase 46 反省)
- 楽観排他 version UPDATE 失敗の 4 way 分岐は実装やや複雑、Codex 委任時に詳細指示
- `notification_outbox.target_id` は NOT NULL FK uuid。spot 業者でも transport_orders.vendor_id が main FK で常に存在 → 問題なし

---

*Generated by phase-handoff skill / Plan revised by Claude at 2026-05-26 (Phase 47 改訂版、Codex review BLOCK 2 + WARN 5 反映、scope 5 副作用 / test 12 件)*
