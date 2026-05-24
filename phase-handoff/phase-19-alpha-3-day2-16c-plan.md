# Phase 19: Sprint α-3 Day 2 / 16-C respondToTransportOrder Plan (v2, Codex review 反映)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 19 |
| 状態 | planning v2 (Codex adversarial review 反映済、実装着手可) |
| v1 → v2 変更要因 | Codex del-20260524-125544-f9af 指摘 P0 2 件 + P1 7 件 + P2 4 件反映 |
| 計画開始 | 2026-05-24T19:00+09:00 |
| 前 Phase | phase-18-alpha-3-day1-16b.md (sealed, commit 977a039) |
| 目的 | registered vendor の **accept/reject 応答** を単一 RPC で atomic に処理 + service wrapper + tests |
| roadmap 整合 | α-3 Day 2 (5/31) 業者ループ実装 — invitation 応答経路を closing |

## このフェーズで達成すること (DoD)

- DDL `24_vendor_rpcs.sql` 新規で `respond_to_transport_order(p_invitation_id, p_response, p_reason?)` 追加 (**単一 RPC 集中設計**、SECURITY DEFINER + authenticated GRANT)
- RPC 内で全処理を完結: auth 検証 / accept 時は `accept_invitation_and_revoke_others` 呼出 + status_id 更新 + status_history append / reject 時は invitation のみ更新
- service 関数 `respondToTransportOrder(db, input)` は薄い wrapper (Zod validate + RPC call + Postgres error mapping)
- audit_logs は trigger 自動記録 (service/RPC で手動 INSERT 禁止)
- unit test + integration test で `pnpm test` 49 → 60+ 維持
- typecheck PASS / migration full apply PASS

## v1 → v2 主要変更点 (Codex review 反映)

| # | v1 | v2 | 根拠 |
|---|---|---|---|
| 1 | hybrid: status_id 更新を service 層 | **単一 RPC 集中**: 全処理を RPC 内 | spec phase-16-plan §16-C 元仕様 + ADR-0008、atomic 性向上 |
| 2 | StatusTransitionError ← P0002 マップ | **P0001** マップ | trg_enforce_status_transition は P0001 raise (20_triggers.sql:90-93) |
| 3 | integration test auth context 未設計 | **vendor_users seed + `set_config('request.jwt.claims', ...)` で `auth.uid()` 設定** を fixture 化 | 既存 RPC は `current_vendor_user_id()` 経由で auth.uid() 解決、test で設定必須 |
| 4 | 全 reject 時の order 終端未定義 | **16-E に scope outside 明記**: Phase 19 は invitation 単位のみ、全 pending 消滅時の order 終端 (rejected 化) は 16-E で `closeTransportOrderOnAllRejected` service 追加 | spec §7.10 未記載のため設計判断、scope 膨張回避 |
| 5 | seedTransportStatuses 未使用維持 | **Drizzle 対応に書き換え**、Phase 18 既存 inline seed も helper 呼出に統一 (refactor) | DRY 確保、helper 役割明確化、16-E までの暫定継続 |
| 6 | input に actingVendorUserId 含む記述 / Zod に未定義 (矛盾) | **完全削除**、`{ invitationId, response, reason? }` のみ | spoof 防止、production で `current_vendor_user_id()` 集中 |
| 7 | error は 3 種類のみ | **`ConcurrentTransportOrderResponseError` (55P03) / `InvalidResponseValueError` (Zod) 追加**、P0002 の message 別分類 | Codex 指摘、未網羅 path 解消 |
| 8 | idempotency = caller 責務 | **plan で UI 層 409 表示を 16-D scope に明記**、Phase 19 は P0002 raise 維持 | UI 二重 submit 対策は 16-D portal で実装 |

## 主要設計判断 (v2 確定)

1. **単一 RPC 集中**: `respond_to_transport_order(p_invitation_id, p_response, p_reason?)` が ① auth 検証 (`current_vendor_user_id()` + vendor 一致) ② pending 検証 ③ accept 時は内部で `accept_invitation_and_revoke_others` を呼出 (既存 RPC 再利用) + `transport_orders.status_id` 更新 + `transport_order_status_history` append ④ reject 時は invitation のみ `response='rejected'` + `responded_at=now()` ⑤ RETURNING で `(transport_order_id, version, invitation_id, new_status_id?, history_id?)` を返却
2. **status 解決**: accept 時は RPC 内で `SELECT id FROM statuses WHERE company_id = ? AND status_type='transport' AND key='accepted'` で `accepted` status_id 解決。見つからなければ raise (E0001 相当の独自 SQLSTATE)
3. **status_history changed_by_user_id=NULL**: vendor 操作は社内 user_id を持たない、status_history.changed_by_user_id NULL 許容済 (Phase 18 確認済)
4. **reject 時の transport_order 不変**: 自身の invitation のみ rejected 化、transport_order.status_id 不変、status_history append なし。**全 pending 消滅時の order 終端処理は 16-E に scope outside**
5. **fixture helper Drizzle 化**: `seedTransportStatuses` を Drizzle transaction 引数で受けて INSERT する形に refactor。Phase 18 既存 integration test の inline seed も helper 呼出に統一 (合わせて Phase 18 test refactor)
6. **input shape**: `RespondToTransportOrderInput = z.object({ invitationId: uuid, response: z.enum(['accepted', 'rejected']), reason: z.string().max(500).optional() }).strict()`。`actingVendorUserId` なし
7. **error mapping** (service 層):
   - `P0001` + message contains 'invalid status transition' → `StatusTransitionError`
   - `P0002` + message contains 'not pending or not found' → `InvitationNotPendingError`
   - `P0002` + message contains 'spot invitation flow' → `InvitationNotPendingError` (16-C scope outside、後続 phase で別エラー)
   - `42501` → `VendorAuthError`
   - `55P03` → `ConcurrentTransportOrderResponseError`
   - その他 → 透過 (unhandled DB error)

## 主要ファイル (新規/変更)

| ファイル | 種別 | 想定行数 |
|---|---|---|
| `src/lib/db/raw-migrations/alpha-1-public/24_vendor_rpcs.sql` | 新規 | ~110 |
| `src/lib/services/transport-orders.ts` | 追記 (`respondToTransportOrder`) | +~80 |
| `tests/unit/services/transport-orders.test.ts` | 追記 (~6 ケース) | +~60 |
| `tests/integration/services/transport-orders.integration.test.ts` | 追記 (~8 ケース) + inline seed → helper 呼出 refactor | +~320 |
| `tests/_helpers/seed-transport-statuses.ts` | Drizzle 対応に書き換え | ~90 (postgres.js 版から書換) |

Drizzle schema 再生成: 不要 (RPC のみ追加)

## API 契約

### RPC (DDL)
```sql
respond_to_transport_order(
  p_invitation_id uuid,
  p_response text,       -- 'accepted' | 'rejected'
  p_reason text DEFAULT NULL
) RETURNS TABLE(
  transport_order_id uuid,
  version int,           -- accept のみ +1、reject では現在値
  invitation_id uuid,
  new_status_id uuid,    -- accept のみ NOT NULL
  history_id uuid        -- accept のみ NOT NULL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
GRANT EXECUTE TO authenticated
```

### service 関数
```typescript
export const RespondToTransportOrderInput = z.object({
  invitationId: z.string().uuid(),
  response: z.enum(['accepted', 'rejected']),
  reason: z.string().max(500).optional(),
}).strict();

respondToTransportOrder(db, input): Promise<{
  transportOrderId: string;
  invitationId: string;
  version: number;
  newStatusId: string | null;  // reject では null
  historyId: string | null;
}>
```

### Error class (export 追加)
- `InvitationNotPendingError`
- `VendorAuthError`
- `StatusTransitionError`
- `ConcurrentTransportOrderResponseError`

## テスト設計 (integration、auth context 設定込み)

各 test の fixture pattern:
1. company / vendor / vendor_user (auth_user_id 付き) を seed
2. transport_order + invitation を `createTransportOrderWithNotification` で作成
3. test transaction 内で `SELECT set_config('request.jwt.claims', '{"sub":"<auth_user_uuid>"}', true)` (auth.uid() が UUID を返すよう設定)
4. `respondToTransportOrder` 呼出
5. assert

### test ケース (8 件)

1. **accept happy path**: 単独招待 accept → invitation.response=accepted, is_winning_bid=true, transport_orders.status_id=accepted, vendor_id 確定, version++, status_history 1 件追加 (from=requested, to=accepted, changed_by_user_id=NULL, reason 値検証)
2. **reject single**: 単独招待 reject → invitation.response=rejected, responded_at 設定, transport_order.status_id/version 不変, status_history 追加なし
3. **multi-invitation accept revoke**: 3 業者招待中 vendor A accept → 残 2 業者 invitation.response=revoked、winning_bid 一意
4. **non-pending (already accepted)**: 既 accepted invitation を再度 respond → `InvitationNotPendingError`
5. **cross-tenant**: vendor B の invitation を vendor A の vendor_user が accept → `VendorAuthError`
6. **status_transitions seed missing**: status_transitions 未 seed の company で accept → `StatusTransitionError`
7. **accepted status seed missing**: statuses に `accepted` key 未 seed で accept → `StatusSeedMissingError` (RPC が独自 SQLSTATE で raise、service が再分類)
8. **inactive vendor_user**: `is_active=false` の vendor_user で accept → `VendorAuthError` (既存 RPC ガード経路の検証)

unit test (6 件): Zod input validation (invitationId non-uuid / response 無効値 / reason 501 char / 余剰 field / response 欠落 / invitationId 欠落)

## 既存実装との整合性 (invariants)

- 既存 `accept_invitation_and_revoke_others(p_invitation_id)` を改変せず再利用 (Phase 16-A0 で advisory lock + auth ガード済)
- `trg_enforce_status_transition` 既存挙動を変えない
- audit_logs は `trg_record_audit_log` で自動記録 (RPC 内手動 INSERT 禁止)
- Phase 18 invariants (`CreateTransportOrderInput` / `VendorMembershipError` / `StatusSeedMissingError` / idempotency_key 形式) 不変
- Phase 18 integration test の seed pattern を helper 化 (Phase 18 既存テストの assert は不変、seed 部分の DRY refactor のみ)

## scope outside (16-E or 後続 phase 延期、明文化)

- 全 invitation reject 時の transport_order 終端処理 (`closeTransportOrderOnAllRejected` service)
- UI 二重 submit 対策 (16-D で portal 側 409 表示 / idempotent retry)
- spot invitation (未登録業者 vendor_id NULL) の accept flow (16-E)
- transport_orders の `vendor_response` / `vendor_response_at` / `vendor_rejection_reason` 列更新 (KPI 用、spec §14.7、β 繰越)
- `addInvitationToTransportOrder` 単独 service (現状 integration test 内で複数 INSERT 直書き、必要なら 16-E で抽出)

## Codex 委任戦略

| 工程 | 委任先 | 理由 |
|---|---|---|
| 計画 adversarial review | Codex (del-20260524-125544-f9af) | 完了済 |
| DDL 24_vendor_rpcs.sql | Codex 強制 | ボイラープレート + PL/pgSQL |
| service 関数追加 | Codex 強制 | +80 行で閾値超過 |
| seedTransportStatuses Drizzle 化 | Codex 強制 | tests/_helpers/ 強制委任パス |
| unit test | Codex 強制 | tests/ 強制委任パス |
| integration test | Codex 強制 | tests/ 強制委任パス |
| Phase 18 既存 integration test refactor (inline seed → helper 呼出) | Codex 強制 | tests/ 強制委任パス |
| Claude 担当 | 統合判断・テスト実行確認・seal | 最終 review |

## 既知の懸念・残課題

- **(A)** RPC 内で `accepted` status 解決失敗時の SQLSTATE をどう設計するか (現案: 独自 `S0001` or 既存 `P0002` 流用)。Codex 実装委任時に最終確定
- **(B)** Phase 18 integration test refactor で既存 assert が壊れないか (helper 化のみで動作保証必要)
- **(C)** Codex Windows sandbox R-H-002: Write/Edit 通過、pnpm test は claude 側で実行
- **(D)** roadmap 5/31 release 条件: 16-C 完了で α-3 Day 2 達成、16-D は別 phase (16-D ブロックではない)

## 次のアクション (この plan v2 で実装着手)

1. Codex 委任 6 件 (DDL, service, helper refactor, unit, integration, Phase 18 test refactor) 順次発火
2. `pnpm test` 60+ PASS 確認 → Phase 19 seal handoff 作成
3. commit & push、16-D / 16-E は次セッション以降

## 関連 ledger / 参考

- Codex adversarial review: del-20260524-125544-f9af (P0 2 + P1 7 + P2 4 指摘、本 plan v2 で反映)
- `phase-handoff/phase-18-alpha-3-day1-16b.md` (前 phase sealed)
- `phase-handoff/phase-16-vendor-loop-plan.md` line 78-86 (16-C 元仕様)
- `spec/data-model.md` §7.10 (line 833-942) / §15.6 (line 1576-1585)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` line 153-249 (既存 RPC)
- `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql` line 77-99 / 251-255 (trg_enforce_status_transition は P0001 raise)

---

*Generated by phase-handoff skill / Filled by Claude at Phase 19 planning v2 (2026-05-24, Codex review 反映)*
