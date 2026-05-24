# Phase 21 / 16-E Recon: closeTransportOrderOnAllRejected

> Codex Windows sandbox 全 block (`spawn setup refresh`) で初回 Codex recon 失敗。Claude が Grep のみで巻取り (sandbox-blocked override 相当)。実ソース root: `C:\Users\kamit\dev\pit_system`

## 1. transport_orders 終端 status 構造 (絶対パス + 行番号)

- **`src/lib/db/raw-migrations/alpha-1-public/12_transport.sql:35`**: `transport_orders.status_id uuid NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT` — enum **ではなく** `statuses` テーブル uuid FK で管理。終端値は seed-driven
- **`12_transport.sql:128-129`**: `CONSTRAINT transport_orders_vendor_response_check CHECK (vendor_response IN ('pending', 'accepted', 'rejected'))` — order-level の `vendor_response` は別途 enum-like
- **`12_transport.sql:47`**: `transport_order_status_history` 別 table 存在 (from_status_id / to_status_id) — 遷移時はここに record 推奨
- **要次フェーズ確認**: `statuses` table の actual seed (closed / cancelled / failed 候補) は `21_seed_master.sql` に未出現、別 seed ファイル or migration の可能性。**plan 起草時に grep "INSERT INTO statuses" 全 sql で再確認 (今回 head_limit 50 内未取得)**

## 2. 既存 respondToTransportOrder reject 経路 (Phase 19)

- **`src/lib/db/raw-migrations/alpha-1-public/24_vendor_rpcs.sql:5`**: 公式コメント **"reject updates only the caller's invitation; all-rejected order closure is 16-E scope"** — Phase 19 で意図的に分離。今 Phase が引き取る対象
- **`24_vendor_rpcs.sql:131-140`**: reject 分岐は `transport_order_invitations` の自分のレコード更新のみ (`UPDATE ... WHERE toi.id = p_invitation_id`)、transport_orders は touch しない
- **`src/lib/services/transport-orders.ts:212` (InvitationNotPendingError) / `:222` (VendorAuthError) / `:232` (StatusTransitionError) / `:242` (ConcurrentTransportOrderResponseError) / `:252` (InvalidResponseValueError)**: 5 error class、`static readonly code` 付き (Phase 20 追加)
- aggregate 判定は **既存 RPC/service に未存在**、新規実装が必要

## 3. aggregate 判定の推奨実装

- 対象 transport_order を `SELECT ... FOR UPDATE` で先行 lock → 同 tx 内で対象 order の全 `transport_order_invitations` を集計
- 集計 query (擬似): `SELECT count(*) FILTER (WHERE response = 'rejected') AS rejected, count(*) FILTER (WHERE response = 'pending') AS pending, count(*) FILTER (WHERE response = 'accepted') AS accepted FROM transport_order_invitations WHERE transport_order_id = $1`
- 終端遷移条件: `pending = 0 AND accepted = 0 AND rejected > 0` → status を `closed` (or `cancelled` / `all_rejected`) seed に遷移
- **必須**: 集計 query は SELECT FOR UPDATE 後に実行 (concurrent reject race 回避)、accept_invitation_and_revoke_others の advisory lock pattern と整合 (`18_helper_functions.sql:153`)
- **代替案**: Phase 19 `respond_to_transport_order` RPC line 134 直後に inline aggregate + 終端遷移を追加 (RPC 拡張)。ただし Phase 19 invariant "reject updates only the caller's invitation" に明示反するため、**別 service / 別 RPC で分離が推奨**

## 4. trigger 干渉ポイント

- **`20_triggers.sql:7`**: `record_audit_log` は `23_record_audit_log.sql` で separate (Phase C-2b 設計)、transport_orders.status_id 更新時の audit 経路は別ファイル
- **`23_record_audit_log.sql`**: 詳細未確認、transport_orders UPDATE で trigger 発火するか **plan 起草時に再確認**
- `transport_order_status_history` への INSERT は service 側責務の可能性高い (trigger 化されていれば status 更新だけで OK、されていなければ明示 INSERT 必要)。**要確認**

## 5. 推奨 service シグネチャ案

```ts
// 新規 src/lib/services/transport-orders.ts に追加 (既存 export 不変)
export async function closeTransportOrderOnAllRejected(
  tx: DrizzleTx,
  transportOrderId: string,
): Promise<{ closed: boolean; statusId?: string }>

// or 完全別ファイル src/lib/services/close-transport-order.ts
```

- input: `tx` (caller の同 transaction 内、`withAuthenticatedDb` 経由) + `transportOrderId`
- output: `closed: true` (終端遷移実行) / `closed: false` (pending/accepted 残あり no-op)
- 副作用: `transport_orders.status_id` 更新 + `transport_order_status_history` INSERT (trigger 不在時) + 必要なら `transport_orders.vendor_response = 'rejected'` 更新
- **caller**: `respondToTransportOrder` の reject 分岐末尾で呼び出し (同 tx 内、自分の reject UPDATE 直後)
- **RPC 化判断**: aggregate + UPDATE は service-side で完結可能なら RPC 不要。RLS 経由で UPDATE 許可される設計なら不要、service-role 必須なら RPC 化

## 6. 既存 error class 拡張

- 新 error 不要 (no-op or success のため例外不要)
- **例外的に追加候補**: `OrderAlreadyClosedError` (concurrent 2 vendor が同時最後 reject → 1 件目が終端、2 件目が既終端を再判定) — ただし aggregate query を SELECT FOR UPDATE 配下で実行すれば race 回避可能、不要の可能性高い
- 既存 6 error class の `code` プロパティは Phase 20 invariant、touch 禁止

## 7. テスト種別と既存 fixture 再利用

- **happy**: 3 vendor 全 reject → 最後 reject で `transport_orders.status_id = closed seed`、`transport_order_status_history` に row 追加
- **partial**: 1 accept + 1 reject + 1 pending → no-op、status 不変
- **partial-2**: 3 reject 中 2 のみ → no-op (pending 残あり)
- **concurrent**: 2 vendor 同時最後 reject → 1 件のみ closed 遷移、もう片方は no-op (FOR UPDATE 効く)
- 既存 `tests/integration/services/transport-orders.integration.test.ts` (Phase 19/20 16 ケース) の fixture (vendor user / withAuthenticatedDb / transport_order seed) を再利用、+3〜4 ケース想定

## 8. 警告・既存壊してはいけないもの (invariants)

- Phase 19 invariants 全継承: `respondToTransportOrder` シグネチャ・既存 error class `code` プロパティ・`respond_to_transport_order` RPC signature
- `24_vendor_rpcs.sql:5` コメント記載の意図 ("reject updates only the caller's invitation") を破る場合は spec 整合確認必須
- `transport_order_status_history` への明示 INSERT を service で行う場合、既存 status 遷移 (Phase 19 accept 経路) と同 pattern 採用
- Phase 20 invariants: `withAuthenticatedDb(authUserId, fn)` シグネチャ、`(vendor-portal)/vendor/` 配下
- `pnpm test` 66/66 PASS 維持

## 9. plan 起草前に追加で要確認 (未解消 TODO)

1. **statuses table の actual seed (closed / cancelled / failed 候補)** — `INSERT INTO statuses` 全 sql grep
2. **`23_record_audit_log.sql` の transport_orders 対象 trigger 設定** — UPDATE trigger の有無
3. **`transport_order_status_history` への trigger or 手動 INSERT 設計** — Phase 19 accept 経路で実装済か
4. **`accept_invitation_and_revoke_others` (18_helper_functions.sql:153) の advisory lock key 採番ルール** — close-order 側で同 key 使うか別 namespace か

---
*巻取り元: Codex sandbox-blocked (admin invitation と同 batch), Claude completed via 5 Grep calls / 0 Bash / minimal context spend.*
