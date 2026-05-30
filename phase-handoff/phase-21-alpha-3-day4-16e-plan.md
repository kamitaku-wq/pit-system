# Phase 22 / Sprint α-3 Day 4 / 16-E Plan v2

> Phase 21 (planning-only) で起草。実装は別セッション = Phase 22。
> 起草者: Claude (recon 3 件統合) → Codex adversarial review (`del-20260524-153952-8f07`) で Major revisions → Plan v2 化。
> 関連 recon: `phase-handoff/phase-21-16e-recon-{playwright,spot-rpc,close-order}.md`、admin-invitation recon は Codex sandbox 失敗で未生成、β 繰越とする。
> Plan v1 → v2 主要変更: §2 A1 を SECURITY DEFINER RPC 化、§2 history schema 修正、§3 二重 submit 戦略変更、§5 admin 繰越根拠追加、§7 リスク再評価。

## 0. ゴール

Sprint α-3 (vendor 招待 → 受諾/辞退ループ) の sealed 完了。Phase 20 (16-D vendor portal frontend) で残った 2 つの意図的未実装機能を埋める:

1. **closeTransportOrderOnAllRejected**: 全 invitation reject 時の order 終端処理 (`24_vendor_rpcs.sql:5` で「16-E scope」明示)
2. **E2E test**: Phase 20 で構築した vendor portal loop の動作保証 (`tests/e2e/vendor-portal-loop.spec.ts`)

`spot invitation flow` と `admin invitation UI/API` は **β 繰越** (理由: §5)。staging smoke は最後の確認手段として実施。

## 1. 16-E 実装スコープ確定 (A/B/C 分類)

### A. 必須実装 (Phase 22 で完遂)

| # | 項目 | 規模 | Codex 委任 |
|---|---|---|---|
| A1a | **SECURITY DEFINER RPC** `close_transport_order(p_transport_order_id uuid)` migration | ~70 行 SQL | **強制委任** (Phase 19 RPC pattern 踏襲) |
| A1b | service thin wrapper `closeTransportOrderOnAllRejected(tx, orderId)` | ~30 行 | **強制委任** (helpers/services) |
| A2 | `respondToTransportOrder` reject 分岐末尾で A1b を呼ぶ統合 | ~10 行修正 | Claude 直接可 (10 行未満) |
| A3 | E2E test fixture / seed helper 抽出 (`tests/_helpers/seed-vendor-e2e.ts`) | ~120 行 | **強制委任** (helpers/) |
| A4 | `tests/e2e/vendor-portal-loop.spec.ts` 新規 (2 ケース、E2E から二重 submit 除外) | ~120 行 | **強制委任** (tests/) |
| A5 | A1 の integration test +4 ケース (happy / partial / concurrent / 二重 submit race) | ~110 行 | **強制委任** (tests/) |

合計: コード ~460 行、test +6 (integration +4 + e2e +2)。Plan v1 比 A1 が RPC 化で +20 行、E2E から二重 submit を integration race test に移動。

### B. 推奨実装 (時間あれば)

| # | 項目 | 規模 | 判断 |
|---|---|---|---|
| B1 | staging smoke: Resend 疎通 + 実 vendor user で 16-D loop 手動確認 | 手動、~30 分 | 16-E sealed 直前に実施、QA レポート 1 ページ |
| B2 | RespondForm に `data-testid` 追加 (E2E selector 安定化) | ~5 行 × 3 箇所 | A4 着手後に発見次第追加 |

### C. β 繰越 (Sprint β 以降)

| # | 項目 | 繰越理由 |
|---|---|---|
| C1 | spot invitation flow (RPC + service + UI 拡張) | scope 大 (RPC + RLS policy 拡張 + `vendor_invited_transport_order_ids` helper 拡張 + 一覧 UI 拡張 + reject 所有確認設計が未仕様)、`offered_amount_minor` 列未定義で金額入札も別設計 |
| C2 | admin 側 vendor user invitation UI/API | recon 未完了 (Codex sandbox 失敗)、auth.users 作成 + RBAC + Resend email + invitation token URL 設計が大、16-E 範囲外と Phase 20 sealed で既明示 |
| C3 | CI workflow に E2E 統合 | A4 完成後、ローカル PASS 確認のみで sealed、CI 統合は β |

## 2. A1 closeTransportOrderOnAllRejected 設計 (Plan v2 RPC 化)

### A1a SECURITY DEFINER RPC (新 migration `25_close_transport_order.sql`)

```sql
CREATE OR REPLACE FUNCTION public.close_transport_order(p_transport_order_id uuid)
RETURNS TABLE(
  transport_order_id uuid,
  closed boolean,
  new_status_id uuid,
  history_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_from_status_id uuid;
  v_terminal_status_id uuid;
  v_accepted int;
  v_pending int;
  v_rejected int;
  v_history_id uuid;
BEGIN
  -- 行 lock (RLS bypass、SECURITY DEFINER のため)
  SELECT company_id, status_id INTO v_company_id, v_from_status_id
    FROM public.transport_orders
    WHERE id = p_transport_order_id
    FOR UPDATE;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'transport_order not found' USING ERRCODE = 'P0002';
  END IF;

  -- aggregate (同 tx 内、FOR UPDATE 後)
  SELECT
    COUNT(*) FILTER (WHERE response = 'accepted'),
    COUNT(*) FILTER (WHERE response = 'pending'),
    COUNT(*) FILTER (WHERE response = 'rejected')
  INTO v_accepted, v_pending, v_rejected
  FROM public.transport_order_invitations
  WHERE transport_order_id = p_transport_order_id;

  IF v_accepted > 0 OR v_pending > 0 OR v_rejected = 0 THEN
    RETURN QUERY SELECT p_transport_order_id, false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- terminal status lookup (statuses.is_terminal = true + entity_type = 'transport_order')
  -- ※ Phase 22 実装直前に seed name 確認、複数候補なら明示名で WHERE
  SELECT id INTO v_terminal_status_id
    FROM public.statuses
    WHERE entity_type = 'transport_order'
      AND is_terminal = true
      AND name IN ('closed', 'all_rejected', 'cancelled')  -- 実 seed 名で絞り込み
    ORDER BY name = 'all_rejected' DESC, name = 'closed' DESC
    LIMIT 1;
  IF v_terminal_status_id IS NULL THEN
    RAISE EXCEPTION 'terminal status seed missing' USING ERRCODE = 'P0002';
  END IF;

  -- transport_orders 更新 (SECURITY DEFINER で RLS bypass、内部認可)
  UPDATE public.transport_orders
     SET status_id = v_terminal_status_id,
         vendor_response = 'rejected',
         updated_at = now()
   WHERE id = p_transport_order_id;

  -- history INSERT (実 schema: company_id, transport_order_id, from_status_id, to_status_id, changed_by_user_id, reason, changed_at default)
  INSERT INTO public.transport_order_status_history (
    company_id, transport_order_id, from_status_id, to_status_id,
    changed_by_user_id, reason
  ) VALUES (
    v_company_id, p_transport_order_id, v_from_status_id, v_terminal_status_id,
    NULL,  -- system-triggered close、auth.uid() でも可だが reject 最後 caller を入れるか議論
    'all invitations rejected (auto close)'
  ) RETURNING id INTO v_history_id;

  RETURN QUERY SELECT p_transport_order_id, true, v_terminal_status_id, v_history_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_transport_order(uuid) TO authenticated;
```

### A1b service thin wrapper (`src/lib/services/close-transport-order.ts`)

```ts
import type { DrizzleTx } from "@/lib/db/types";
import { sql } from "drizzle-orm";

export interface CloseTransportOrderResult {
  closed: boolean;
  newStatusId?: string;
  historyId?: string;
}

export async function closeTransportOrderOnAllRejected(
  tx: DrizzleTx,
  transportOrderId: string,
): Promise<CloseTransportOrderResult> {
  const result = await tx.execute(sql`
    SELECT * FROM public.close_transport_order(${transportOrderId}::uuid)
  `);
  const row = result.rows[0] as {
    closed: boolean;
    new_status_id: string | null;
    history_id: string | null;
  };
  return {
    closed: row.closed,
    newStatusId: row.new_status_id ?? undefined,
    historyId: row.history_id ?? undefined,
  };
}
```

### 設計判断 (Plan v1 比改訂点)

- **RLS bypass 必須**: `transport_orders` UPDATE policy は `vendor_id = current_vendor_id()` で vendor caller を許可しない経路 (`vendor_id` が assigned されていない / vendor_id mismatch) で fail。Phase 19 `respond_to_transport_order` と同じ SECURITY DEFINER pattern で内部認可。
- **history schema 修正**: 実 schema (`12_transport.sql:47-55`) は `id / company_id / transport_order_id / from_status_id / to_status_id / changed_by_user_id / reason / changed_at` (`version` 列なし、`changed_at` default `now()`)。Plan v1 spec を完全置換。
- **terminal status lookup**: `statuses.is_terminal` 列が存在 (`03_roles_statuses.sql:36`)、`entity_type = 'transport_order'` + name IN (...) で絞り込み。**Phase 22 実装直前に `INSERT INTO statuses` 全 sql で seed name 確認必須** (TODO §9)。
- **race condition**: `FOR UPDATE` で行 lock + 同 tx 内 aggregate → accept 経路の advisory lock と互いに排他、accept 後の close-order は `accepted > 0` で no-op 返す → 整合 OK。

## 3. A3/A4 E2E test 設計

### fixture (`tests/_helpers/seed-vendor-e2e.ts`)

- `seed-vendor-dev.ts` を read のみ参考、E2E は **transport_order + 3 invitation (vendor A, B, C)** が必要なため別 helper
- idempotent + cleanup: order_number に `e2e-loop-{uuid}` prefix → spec の `afterEach` で WHERE prefix DELETE
- 出力: `{ orderId, invitationIds: [a, b, c], vendorUsers: { a: {email, password}, b: ..., c: ... } }`
- 内部: Drizzle `db.transaction` で挿入、Supabase admin SDK で 3 vendor auth.users 作成 (もしくは seed-vendor-dev で 3 user 先行 seed しておく)

### spec (`tests/e2e/vendor-portal-loop.spec.ts`)

2 ケース (Plan v1 比 1 減: 二重 submit を A5 integration test に移動):

1. **happy path**: vendor A login → `/vendor/requests` 一覧表示 → 詳細 click → accept submit → 一覧再表示で消える + DB で `invitation.response='accepted'`, `winning=true` 確認
2. **RLS 漏洩**: vendor A login → 別 vendor B 宛の `/vendor/requests/[id]` 直 URL → `notFound` (404 page) 確認

**二重 submit は A5 integration test (Promise.all race) で検証**: Playwright click 連打は form disable で 2 件目 no-op 化、real concurrent request を再現できない (adversarial review #2 指摘)。integration test で `Promise.all([respondToTransportOrder(...), respondToTransportOrder(...)])` race を直接検証。

### selector 方針

- 既存 `RespondForm` は `data-testid` なし → A4 着手時に「accept-button」「reject-button」「invitation-list-item」を追加 (B2)
- フォールバック: text selector (`getByRole('button', { name: '承諾' })`)
- baseURL: `PLAYWRIGHT_BASE_URL ?? http://localhost:3000`

### fixture cleanup (auth.users 含む)

A3 helper の `afterAll` で:
- DB cleanup: `DELETE FROM transport_orders WHERE order_number LIKE 'e2e-loop-%'` (CASCADE で invitations / status_history も削除)
- **Supabase auth cleanup**: `supabase.auth.admin.deleteUser(authUserId)` を vendor A/B/C 各々で呼ぶ (adversarial review #3 指摘)、storageState ファイル削除
- storageState 保存先: `playwright/.auth/vendor-{a,b,c}.json` (gitignore 推奨)

### CI 判断

CI workflow なし。Phase 22 ではローカル PASS のみで sealed (C3 で β 繰越)。手動: `pnpm test:e2e`。

## 4. 委任戦略 (Phase 20 教訓反映)

Phase 20 で発生した問題:
1. **委任 #4/#5 並列で同一 page.tsx 上書き衝突** → 今回 A1/A3/A4/A5 のターゲットファイル全分離 (`close-transport-order.ts` / `seed-vendor-e2e.ts` / `vendor-portal-loop.spec.ts` / 既存 integration test ファイル追記) で衝突なし
2. **implicit any 型注釈漏れ** → 委任 prompt に「全 callback 引数に型注釈必須」明示
3. **Codex Windows sandbox R-H-002 不安定** → 失敗時は Claude 巻取り + ledger override pattern (Phase 21 close-order recon と同じ)

委任順序 (Phase 22 セッション):
1. A3 (seed helper) + A1 (close service) **並列**
2. A1 完了後 → A2 (Claude 直接 patch、10 行未満) + A5 (integration test 追加)
3. A4 (E2E spec) — A3 完成後の依存タスク

委任率目標: ~90% (A2 のみ Claude、他 4 件 Codex)。

## 5. β 繰越判断の根拠

### C1 spot invitation flow を 16-E に入れない理由

- **RLS 拡張**: `vendor_select` policy は `vendor_id = current_vendor_id()` のみ、spot (`vendor_id NULL`) は vendor portal で **見えない** → 一覧表示まで実装するなら `policy USING (... OR (vendor_id IS NULL AND invitee_email = current_user_email()))` 相当が必要 + `vendor_invited_transport_order_ids` helper も拡張
- **reject 所有確認未設計**: spot reject は vendor_user の vendor_id mismatch では認可できず、invitee_email との email 一致 / token 所有確認設計が新規必要
- **`offered_amount_minor` 列未定義**: 金額入札まで含めるなら schema 拡張 + service input 拡張 + UI 拡張、Phase 22 で詰め切れない
- **代替案**: spot RPC accept-only minimum (reject は β 繰越、accept は「caller が invitee_email 一致 vendor_user」前提で実装) なら 16-E に含められるが、これも UI 一覧表示問題が残るため Plan v1 では **β 繰越** 判断

### C2 admin invitation を 16-E に入れない理由

- Phase 20 sealed handoff lines 129-131 で「16-E or β 繰越」と既明示
- recon 失敗 (Codex sandbox `bbr1q9m1z` 完了通知未受領、ファイル `phase-21-16e-recon-admin-invitation.md` 未生成)、scope 推定が立たない
- auth.users 作成 + email 招待 + token URL + RBAC + invitation expiration 設計など実装規模大
- **Phase 22 は 16-E sealed が最優先**、scope 拡大で sealed 失敗するリスク回避
- **β 着手前の追加 recon が必須**: spot invitation flow (C1) と admin invitation (C2) は β Phase 開始時に再 recon → 別 Phase scope で詳細設計

## 6. 不変条件 (Phase 22 で守る)

- Phase 19 invariants 全継承: `respondToTransportOrder` シグネチャ、6 error class `code` プロパティ、`respond_to_transport_order` RPC signature、`accept_invitation_and_revoke_others` RPC signature、`24_vendor_rpcs.sql:5` コメント記載の意図
- Phase 20 invariants 全継承: `withAuthenticatedDb(authUserId, fn)` シグネチャ、middleware matcher `/vendor/:path*`、seed credentials `vendor-dev1@example.com` / `vendor-dev-pass-001`、`(vendor-portal)/vendor/` 配下のファイル配置
- `pnpm test` 66/66 PASS は **A5 完了時に 69/69 PASS** に増える、減らない
- `pnpm typecheck` PASS 維持

## 7. リスク & 緩和 (Plan v2 改訂)

| リスク | 影響 | 緩和 |
|---|---|---|
| `statuses` table に transport_orders 終端 seed が無い | A1a RPC 実行時 `terminal status seed missing` で fail | **Phase 22 実装直前** に `INSERT INTO statuses` 全 sql grep + `is_terminal=true` 行確認、未 seed なら A1a の前段 migration として `INSERT` を追加 (owner: Phase 22 着手 Claude) |
| `transport_order_status_history` への INSERT が trigger 化されているか不明 | A1a で二重 INSERT or 漏れ | `20_triggers.sql` + `23_record_audit_log.sql` 詳細確認、trigger 不在 → 明示 INSERT (本 Plan)、trigger 在 → A1a の INSERT 削除 |
| E2E test で auth state 管理が複雑化 | A4 工数膨張 | storageState pattern 採用、auth helper を A3 fixture に統合、`afterAll` で `supabase.auth.admin.deleteUser` 必須 |
| Codex Windows sandbox 再発 | 委任失敗 | Phase 20/21 と同じ Claude 巻取り + ledger override 運用、A1a/A3 で発生したら Claude 直接実装 (RPC SQL は 70 行で巻取り可能) |
| concurrent reject race (2 vendor 同時最後 reject) | A1 で重複終端 | RPC 内 `SELECT FOR UPDATE` で行 lock、aggregate query は同 tx 内 (race 回避)、SECURITY DEFINER で RLS bypass |
| **(新) RLS UPDATE policy 違反** | Drizzle 直接 UPDATE で fail | **A1a を SECURITY DEFINER RPC 化で解消済 (Plan v2)**、service は thin wrapper のみ |
| **(新) E2E 二重 submit click 連打が無効** | A4 で false PASS | **二重 submit を A5 integration test (Promise.all race) に移動 (Plan v2)**、E2E は 2 ケースに減らす |
| **(新) A3/A1 並列委任時の target file 衝突** | Phase 20 #4/#5 と同問題再発 | **target path 全分離確認済** (A1a `25_close_transport_order.sql` / A1b `close-transport-order.ts` / A3 `tests/_helpers/seed-vendor-e2e.ts` / A4 `tests/e2e/vendor-portal-loop.spec.ts` / A5 既存 integration test 追記)、重複なし |

## 8. 次セッション (Phase 22) 着手手順

1. `/clear` 後 phase-handoff 最新 = `phase-21-alpha-3-day4-16e.md` (sealed) を Read で resume
2. Plan v2 (本ファイル) を Read で詳細取得
3. **実装直前確認 (Critical)**: §9 TODO 全消化 (statuses seed / status_history trigger / Phase 19 accept 経路再確認)
4. A1a (RPC migration) + A3 (E2E fixture) 並列委任 (Codex codex-rescue subagent、target file 分離済)
5. A1a 完了 → A1b (service wrapper) 委任 → A2 (Claude patch) + A5 (integration test) 委任
6. A4 (E2E spec) 委任 (A3 完成後)
7. `pnpm test` 70/70 PASS (66 + A5 +4) + `pnpm test:e2e` 2/2 PASS + `pnpm typecheck` PASS 確認
8. B1 staging smoke (手動) → QA レポート
9. Phase 22 seal handoff 書き出し + commit + Sprint α-3 sealed 宣言
10. Sprint β 移行 (C1 spot / C2 admin の再 recon → 別 Phase scope)

## 9. 未解決 TODO (Phase 22 実装前に解消、owner: Phase 22 着手 Claude)

- [ ] `INSERT INTO statuses` grep で transport_orders 終端 seed の有無確認 (`closed` / `cancelled` / `all_rejected` 候補)、`is_terminal=true` 行
- [ ] `23_record_audit_log.sql` の transport_orders UPDATE trigger 確認 (audit_logs 自動 INSERT 経路)
- [ ] `transport_order_status_history` INSERT の trigger / 手動の区別 (Phase 19 accept 経路 `accept_invitation_and_revoke_others` line 153 以降の history 取り扱い再確認)
- [ ] `accept_invitation_and_revoke_others` advisory lock key と close-order の SELECT FOR UPDATE の race 整合性最終確認 (race 設計 §2 の仮説を Phase 22 で実証)
- [ ] admin-invitation recon Codex job (`bbr1q9m1z`) 完了通知の有無確認、ファイル生成されていれば β 着手前の参考に保存 (但し本 Plan は未生成前提で β 繰越確定)
- [ ] B2 `data-testid` 追加リスト 確定 (A4 着手後)
- [ ] RPC caller 認可: SECURITY DEFINER 内で `auth.uid()` ベース check を追加するか議論 (Phase 22 で詰める、現 Plan は no-check)

---
*Generated by Claude at Phase 21 (planning-only). Adversarial review (`del-20260524-153952-8f07`) で Major revisions 指摘 → Plan v2 化完了 → Phase 21 seal へ。*
