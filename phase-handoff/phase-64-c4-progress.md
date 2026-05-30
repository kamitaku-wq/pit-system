# Phase 64-C.4 業者対応不可フォールバック — 進捗ハンドオフ (2026-05-30)

## 完了状況

| サブ | 内容 | 状態 | commit |
|---|---|---|---|
| C.4.0 | 状態モデル補正 (post/0033: rejected stall + rejected→requested + close 是正) | ✅ green | b2573ab + 808b072 |
| C.4.1 | reassignTransportOrderVendor (fallback/manual 統合) + reopenOrderForResolicit helper | ✅ green | 51ffe4b + f6fb404 |
| C.4.2 | rescheduleAndRenotifyTransportOrder (L3-4 希望日時変更再依頼) | ✅ green | d7fadbf + 6ea188b |
| C.4.3 | admin actions (nextVendor/switchVendor/reschedule) + UI panel | ✅ green | 3f9c2e1 |
| C.4.x | outbox idempotency_key 衝突修正 (再打診/再依頼に attempt_seq 付与, seal blocker) | ✅ green | 8b3d4f2 |
| seal | CI green + adversarial gate + handoff seal | ⏳ Codex review 待ち | — |

**検証 (8b3d4f2 時点)**:
- CI ゲート (ci.yml = lint / tsc --noEmit / test:unit / build) **全 green**。
- transport integration (isolation/focused): C.4.0 7/7, C.4.1 11/11 (衝突再現含む), C.4.2 5/5,
  cancel 13/13, 全回帰 114+ green。
- **既知の pre-existing flaky (本 C.4 と無関係, 要注意)**: フル integration suite を並列実行すると
  `transport-orders.integration.test.ts` の dashboard 系 2 件
  (`listTransportOrdersWithLatestInvitation > delayedOnly` / `getAdminDashboardMetrics > counts`) が落ちる。
  - 単独実行は 26/26 green。私の 3 新規テスト除外でも同 2 件落ちる = 既存汚染。
  - 原因: 両テストは withRollback でなく **コミット型 fixture + runWithCompanyContext (RLS GUC)**。
    並列フルスイートで GUC が pooled connection 間で漏れ、exact-count assertion が他テスト行を拾う。
  - dashboard クエリは vendor_response 集計のみで is_terminal/status_id 不参照 = post/0033 と無関係。
  - **CI は integration を実行しない** (live DB 必須ゆえ) ので CI ブロックなし。test-isolation 改善は別 phase。

## seal 前の残作業
1. Codex adversarial review (C.4.1-C.4.3, background agentId 実行中) の結果反映。
   - 最重要候補だった idempotency_key 衝突は Claude 独立検証で先行修正済 (8b3d4f2)。他指摘を待つ。
2. advisor 2 回目 (state machine / 並行性 / cross-tenant フレーム)。
3. CI green 最終確認 → Lane C seal commit。

## 実装済み service (src/lib/services/transport-orders.ts)

### reassignTransportOrderVendor (C.4.1)
```ts
reassignTransportOrderVendor(database, companyId, userId, {
  transportOrderId: uuid,
  expectedVersion: int,
  newVendorId: uuid,
  mode: 'fallback' | 'manual',     // fallback=L3-3次候補打診 / manual=L3-5手動切替
  selectionReasonNote?: string,
  consideredVendorIds?: uuid[],
  reason?: string,
}): Promise<{ transportOrderId, newVersion, newVendorId, newInvitationId, attemptSeq, notificationOutboxId, idempotencyKey }>
```
- rejected stall からのみ (ReassignNotRejectedError)。version 不一致=ConcurrentTransportOrderReassignError。
  非 active vendor=VendorMembershipError。
- fallback: change_type=rejected_reassigned, selection_method=fallback, selection_reason=vendor_unavailable
- manual: change_type=vendor_changed, selection_method=manual, selection_reason=manual_preference

### rescheduleAndRenotifyTransportOrder (C.4.2)
```ts
rescheduleAndRenotifyTransportOrder(database, companyId, userId, {
  transportOrderId: uuid,
  expectedVersion: int,
  requestedPickupAt?: Date,   // 最低 1 つ必須 (Zod refine)
  requestedDeliveryAt?: Date,
  requestedReturnAt?: Date,
  reason?: string,
}): Promise<{ transportOrderId, newVersion, vendorId, newInvitationId, attemptSeq, notificationOutboxId, idempotencyKey }>
```
- rejected stall からのみ (RescheduleNotRejectedError)。同 vendor へ再依頼。vendor 不在=RescheduleNoVendorError。

### 共有 helper reopenOrderForResolicit (private)
- 旧 pending/accepted invitation revoke (rejected は保全) → attempt_seq 純増 INSERT → invitation upsert
  (同 vendor 既存行は pending に戻す、UNIQUE 回避) → order UPDATE (status→requested, vendor 差替, scalar
  リセット vendor_response='pending', requested_*_at COALESCE 更新) → status_history。

## C.4.3 残作業 (admin actions + UI)

### admin actions (src/app/admin/transport-orders/[id]/actions.ts に追記)
既存 cancelTransportOrderAction / confirmTransportOrderAction パターン踏襲。`db` (service_role,
@/lib/db/client) + getAdminUser() (companyId/userId)。**すぐ使えるコード (確認済みパターン)**:

```ts
import { db } from "@/lib/db/client";
import {
  cancelTransportOrder,
  confirmTransportOrder,
  reassignTransportOrderVendor,
  rescheduleAndRenotifyTransportOrder,
} from "@/lib/services/transport-orders";

// 次候補打診 (L3-3)
export async function nextVendorAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const transportOrderId = String(formData.get("transportOrderId") ?? "");
  const newVendorId = String(formData.get("newVendorId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion"));
  if (!transportOrderId || !newVendorId) throw new Error("Invalid input");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error("Invalid expectedVersion");
  await reassignTransportOrderVendor(db, adminUser.companyId, adminUser.userId, {
    transportOrderId, expectedVersion, newVendorId, mode: "fallback",
  });
  revalidatePath(`/admin/transport-orders/${transportOrderId}`);
  revalidatePath(`/admin/transport-orders`);
}

// 手動切替 (L3-5) — mode='manual' のみ nextVendorAction と差分
export async function switchVendorAction(formData: FormData): Promise<void> {
  // ... 同上、mode: "manual"
}

// 希望日時変更再依頼 (L3-4)
export async function rescheduleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const transportOrderId = String(formData.get("transportOrderId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion"));
  const pickupRaw = formData.get("requestedPickupAt");
  // ... 日時 parse (空文字→undefined, 文字列→new Date)、最低 1 つ必須
  await rescheduleAndRenotifyTransportOrder(db, adminUser.companyId, adminUser.userId, {
    transportOrderId, expectedVersion,
    requestedPickupAt: pickup, requestedDeliveryAt: delivery, requestedReturnAt: ret,
  });
  revalidatePath(...);
}
```

### UI panel (src/app/admin/transport-orders/[id]/page.tsx, 438 行)
- **rejected (業者対応不可) status の order の詳細ページにのみ操作パネルを表示**する。
- 3 操作: ① 次候補 vendor 選択 select + 打診ボタン (nextVendorAction) ② 手動切替 vendor 選択
  (switchVendorAction) ③ 希望日時変更フォーム (rescheduleAction)。
- vendor 候補 = active membership の vendor 一覧 (createTransportOrder の membership 検証と同条件)。
  → page.tsx server component で `vendor_company_memberships JOIN vendors WHERE is_enabled AND
  deleted_at IS NULL AND company_id=...` を取得して select に渡す。
- expectedVersion を hidden input で渡す (cancel/confirm パネルと同作法)。
- UI ボイラープレートは Codex 委任候補。既存 cancel/confirm パネルの隣に配置。

### test (C.4.3)
- admin action の thin wrapper test (権限・入力検証) は薄くてよい。主検証は service 層 (C.4.1/C.4.2) で完了済。
- UI は手動確認 or e2e (任意)。

## ⚠️ seal レビュー必須フラグ (手動切替の spec 解釈)

**承認済み plan は L3-5 手動切替 = vendor→vendor の手動選択 (change_type=vendor_changed) と定義**し、
C.4.1 manual mode をそれで実装した。一方 **requirements §16.4 の「手動切替」は「自社対応へ切り替え」**
(= 実質キャンセル) と読める。verification-checklist D.3 も「手動切替 → transport_order がキャンセル状態、
自社対応へ」と記載。

- 現状: C.4.1 manual = 別 vendor への手動切替 (承認済み plan 準拠)。
- spec 解釈: 手動切替 = 自社対応 (= 既存 cancelTransportOrder で代替可能)。
- **seal 前にユーザーに確認**: manual mode を (a) vendor→vendor 維持 (plan 準拠) か (b) 自社対応=cancel に
  読み替えるか。(a) なら UI で「別業者へ手動切替」と表示、(b) なら manual mode を UI から外し cancel に誘導。
  MVP は (a) で進め、(b) が要件なら別 phase で「自社対応」エンティティと共に実装する案を推奨。

## 次セッションの手順
1. 本 handoff + phase-64-c4-1-design.md + phase-64-c4-vendor-fallback-plan.md を読む。
2. C.4.3 admin actions を actions.ts に追記 (上記コード)。
3. page.tsx に rejected order 操作パネル UI 追加 (vendor 候補取得 + 3 フォーム)。Codex 委任可。
4. tsc + lint + 関連 test green 確認。
5. 手動切替 spec 解釈をユーザーに確認 (上記フラグ)。
6. CI green → Lane C seal。
