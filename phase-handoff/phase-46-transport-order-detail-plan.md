# Phase 46 計画 (確定版): §1.5 業者通知・回送管理 詳細ページ `[id]`

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 46 |
| 状態 | confirmed (Codex adversarial review del-20260526-132530-9921 反映済) |
| 前 handoff | `phase-45-notifications-failed-ui-sealed.md` |
| Branch | `phase-42-t4-test-coverage` |
| spec 根拠 | screen-list.md §1.5 line 114 "詳細: 移動パターン / 走行可否 / レッカー要否" + handoff Phase 45 #1 推奨 |
| Review 結果 | BLOCK 3 / WARN 5 / INFO 2 / ALT 2 → BLOCK 全採用 / WARN W3 部分採用・他全採用 / INFO 全採用 / ALT A1 採用・A2 棄却 |

## スコープ (crisp 化)

### IN (Phase 46 に入れる)

| # | item | 説明 |
|---|---|---|
| 1 | service: `getTransportOrderDetail(db, companyId, id)` | UUID guard で early return / soft-delete 除外 / 子 query にも tenant guard / detail を先に fetch → child は Promise.all |
| 2 | interface: `TransportOrderDetail` / `TransportOrderInvitationItem` / `TransportOrderNotificationItem` | invitation.vendorId は nullable、spot 業者対応 |
| 3 | page: `/admin/transport-orders/[id]/page.tsx` | UUID 不正は `notFound()` / cross-tenant も `notFound()` |
| 4 | 一覧 page modify: 案件番号 cell `<Link>` wrap | `import Link from "next/link"` 追加 |
| 5 | integration test 4 件 | 詳細取得 / cross-tenant 拒否 / non-existent id / empty invitations & notifications |

### OUT (Phase 47+ 持ち越し)

- 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / キャンセル
- 招待 revoke / token URL 再発行
- 通知履歴の cancel / 再送 (§1.8 範囲)
- 招待管理ビュー単独 page
- store name 表示 (store ID のみ、JOIN は scope 拡大)
- 通知ログ from `notification_deliveries` (Phase 45 既定: outbox 直接で継続)
- **`last_error` の PII redaction** (Phase 45 §1.8 と同パターン raw 表示で当面継続、Phase 47+ §1.8 共通課題として積み残し)

## 採用 review findings 反映設計

### B1 採用: UUID malformed → `notFound()`

- `page.tsx` 冒頭で `z.string().uuid().safeParse(params.id)` 失敗 → `notFound()`
- DB に malformed UUID を渡す前に guard、500 防止

### B2 採用: soft-delete filter 必須

- detail query で `WHERE t.id = ${id} AND t.company_id = ${companyId} AND t.deleted_at IS NULL`
- integration test で「soft-delete 済 order → null 返却」も assert (4 件 → 5 件に拡張)

→ test を 5 件に増やす:
1. 詳細取得 (本体 + 招待 1 件 + outbox 1 件)
2. cross-tenant 拒否 (別 companyId で null)
3. non-existent id (null)
4. empty invitations & notifications (子配列 0 件)
5. soft-delete 済 (deleted_at IS NOT NULL で null)

### B3 採用: invitation `vendorId: string | null`

- `transport_order_invitations.vendor_id` は nullable (line 31)
- target check は `vendor_id IS NOT NULL OR invitee_email IS NOT NULL` (line 60)
- → interface 更新:
  ```ts
  export interface TransportOrderInvitationItem {
    invitationId: string;
    vendorId: string | null;
    vendorName: string | null;
    inviteeEmail: string | null;
    inviteeName: string | null;
    response: "pending" | "accepted" | "rejected" | "revoked" | "expired";
    invitedAt: Date;
    respondedAt: Date | null;
    isWinningBid: boolean;
  }
  ```
- page 表示: `vendorName ?? inviteeName ?? inviteeEmail ?? "（スポット業者）"`

### W1 採用: 子 query にも tenant guard

- invitations query: `WHERE transport_order_id = ${id} AND company_id = ${companyId}`
- notifications query: `WHERE company_id = ${companyId} AND (transport_order_id = ${id} OR transport_order_invitation_id IN (...))`
- 多層防御 (Phase 45 invariant)

### W2 採用: notification status enum 正規化

- 旧: `"pending" | "sending" | "sent" | "failed"`
- 新: `"pending" | "processing" | "sent" | "failed" | "cancelled"` (notification_outbox 実値)
- `processingStartedAt` 持つ row は status='processing' (Phase 45 requeue で reset した column と整合)

### W3 部分採用: PII redaction は §1.8 全体で対応

- Phase 46 では Phase 45 と同パターン (raw `lastError` 表示)
- Phase 45 §1.8 でも redaction 未対応 → Phase 47+ §1.8 共通課題として handoff 残課題に明記
- Phase 46 単独で先行対応すると §1.8 一貫性壊れる

### W4 採用: outbox は invitation_id 経由も拾う

- `notification_outbox` は 3 種類の FK (`transport_order_id` / `reservation_id` / `transport_order_invitation_id`)
- invitation_id 経由通知 (例: 案件単位招待時の vendor 招待メール) を見落とさないために:
  ```sql
  WHERE company_id = ${companyId}
    AND (
      transport_order_id = ${id}
      OR transport_order_invitation_id IN (
        SELECT id FROM transport_order_invitations
        WHERE transport_order_id = ${id} AND company_id = ${companyId}
      )
    )
  ```

### W5 採用: empty case test 追加

- B2 と統合し test 5 件 (上記 B2 採用節参照)

### I1 採用: Link import 明示

- 一覧 page 冒頭に `import Link from "next/link"` 追加
- 案件番号 cell のみ `<Link href={`/admin/transport-orders/${order.transportOrderId}`}>{order.orderNumber}</Link>`

### I2 採用: invitation tie-breaker

- detail invitation query: `ORDER BY is_winning_bid DESC, invited_at DESC, id DESC`
- 一覧の `listTransportOrdersWithLatestInvitation` の LATERAL は触らない (invariant)

### A1 採用: detail を先に fetch、null skip

```ts
const detailRow = await detailQuery; // guarded SQL
if (detailRow === null) return null;
const [invitations, notifications] = await Promise.all([
  invitationsQuery,
  notificationsQuery,
]);
return { ...detailRow, invitations, notifications };
```

- 子 query を浮かせる前に existence 確認
- cross-tenant attack で child query が走るのを防ぐ

### A2 棄却: jsonb_agg 不採用

- 3 query sequential + child Promise.all で read-committed の偏差は実害なし (page 表示用)
- `jsonb_agg` 採用は scope 拡大、A1 で十分

## TransportOrderDetail interface (確定版)

```ts
export interface TransportOrderDetail {
  transportOrderId: string;
  orderNumber: string;
  movementType: "one_way" | "round_trip" | "pickup_only" | "three_point";
  canDrive: boolean;
  towRequired: boolean;
  pickupStoreId: string | null;
  deliveryStoreId: string | null;
  returnStoreId: string | null;
  requestedPickupAt: Date | null;
  requestedDeliveryAt: Date | null;
  requestedReturnAt: Date | null;
  notificationSentAt: Date | null;
  vendorResponse: "pending" | "accepted" | "rejected";
  vendorResponseAt: Date | null;
  storeConfirmedAt: Date | null;
  statusKey: string;
  statusName: string;
  vendorId: string | null;
  vendorName: string | null;
  notes: string | null;
  createdAt: Date;
  invitations: TransportOrderInvitationItem[];
  notifications: TransportOrderNotificationItem[];
}

export interface TransportOrderInvitationItem {
  invitationId: string;
  vendorId: string | null;
  vendorName: string | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  response: "pending" | "accepted" | "rejected" | "revoked" | "expired";
  invitedAt: Date;
  respondedAt: Date | null;
  isWinningBid: boolean;
}

export interface TransportOrderNotificationItem {
  outboxId: string;
  eventType: string;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  lastError: string | null;
}
```

## Codex 委任タスク分解 (確定版)

### T1: service 層

- file: `src/lib/services/transport-orders.ts` (591 行 → +約 220 行)
- 既存 `expectXxx` helper 再利用
- detail query: `WHERE t.id = ? AND t.company_id = ? AND t.deleted_at IS NULL`
- detail null 確認後、child 2 query を Promise.all
- invitations: 子 tenant guard + `id DESC` tie-breaker
- notifications: 子 tenant guard + invitation_id OR 経由分も拾う
- `notes` column は schema 確認: `transport_orders.notes` 存在前提 (確認は Codex 側で schema 読み込んで verify)
- 全 interface (3 個) export
- pgcrypto / UUID 検証は service 内で不要 (page 側で UUID guard 済)

### T2: page

- new: `src/app/admin/transport-orders/[id]/page.tsx`
- modify: `src/app/admin/transport-orders/page.tsx` (Link import + 案件番号 cell wrap)
- 詳細 page で:
  - `params.id` を `z.string().uuid().safeParse()` で UUID guard、失敗 → `notFound()`
  - `getAdminUser()` 必須、欠如 → `/vendor/login?next=...` redirect
  - `getTransportOrderDetail` 呼出し、null → `notFound()`
  - 3 section: 詳細情報 / 招待一覧 / 通知履歴
  - 招待表示: `vendorName ?? inviteeName ?? inviteeEmail ?? "（スポット業者）"`
  - "← 一覧に戻る" Link
  - 既存 badge helper (vendorResponseBadges / invitationResponseBadges) を一覧 page から再利用したいが、export されてない → page 内に再定義 or 別 file 抽出 → Codex 判断 (page 内再定義で OK、scope 拡大避ける)

### T3: integration test

- file: `tests/integration/services/transport-orders-detail.integration.test.ts`
- 5 cases (B2/W5 採用反映):
  1. 詳細データ正常取得 (本体 + 招待 1 件 + outbox 1 件 + invitation_id 経由 outbox 1 件)
  2. cross-tenant 拒否 (別 companyId で null)
  3. non-existent id (null)
  4. empty invitations & notifications (子配列 0 件)
  5. soft-delete 済 order (null)
- fixture pattern は Phase 45 `notifications.integration.test.ts` mirror

## 既存 invariant に対する整合性

| invariant | 影響 |
|---|---|
| `TransportOrderListItem` (Phase 43 確定) | 触らない、`TransportOrderDetail` 独立追加 |
| `AdminDashboardMetrics` (Phase 44 確定) | 影響なし |
| `FailedNotificationListItem` / requeue semantic (Phase 45 確定) | 影響なし |
| outbox 作成は createAdminVendorInvitation / createTransportOrderWithNotification 時のみ | Phase 46 は SELECT のみ |
| companyId はサーバー側 admin user から取得 | `getAdminUser().companyId` で query guard |
| `listTransportOrdersWithLatestInvitation` の LATERAL JOIN ordering | 触らない、detail の invitation list で別 query (`id DESC` 追加) |

## メトリクス予想

| 指標 | 目標 |
|---|---|
| 変更ファイル | 4 (service modify / detail page new / list page modify / integration test new) |
| 追加行 | service +約 220 / detail page +約 180 / list page modify +約 5 / test +約 280 = 約 685 lines |
| integration test | 96 → 101 (+5) |
| unit test | 35 (変化なし) |
| Codex 委任 | T1 / T2 / T3 (3 件 + adversarial review 1 件 = 4 件、Phase 45 と同構成) |
| Codex 引き取り | 0 (Phase 43→44→45 連続維持を目標) |
| typecheck / unit / integration | 全 PASS (101 件) |

## 次ステップ

1. T1 / T2 / T3 並列 Codex 委任 (本計画を prompt に含める)
2. typecheck / unit / integration 確認 (Claude 側 `npx vitest run`)
3. 引き取り発生時のみ Claude 側 fix
4. Phase 46 seal handoff 書き出し
5. commit 1 件で Phase 46 完了
