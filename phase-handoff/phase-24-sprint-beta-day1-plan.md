# Phase 24 / Sprint β Day 1 Plan v2: spot invitation MVP (Day 1 scope)

> v1.1 → v2: adversarial review (advisor) 10 findings 反映 + user 判断 3 件確定 (F1/F4/F8)。

## Plan Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 24 (Sprint β Day 1) |
| 状態 | **plan-v2 (実装着手可)** |
| 前 Phase | phase-22-alpha-3-day4-16e.md (sealed) |
| 関連 recon | phase-23-sprint-beta-recon-{spot,admin-invite,ci-e2e}.md + phase-23-recon-{spot-onboarding-pipeline,branching-migrations}.md + phase-24-adversarial-review.md |
| 根拠 | advisor 2 ラウンド (4 + 10 findings)、user 判断 6 件 |

## Goal

Sprint β スコープ = spot invitation MVP + CI E2E (Branching)。

**Phase 24 = spot MVP DB/service/onboarding 層 (α/β/γ/δ-server/ε/η)**。UI 修正 + E2E spec + CI Branching は Phase 25。

## 確定済 user judgment

1. admin invitation: 案 A (spec 通り spot 自動)、admin UI は γ 繰越
2. CI Supabase: Strategy A (Branching) MVP、raw-migrations 案 B (env 隔離)
3. spot case (c) (同 email 別 vendor): 実装は `(vendor_id, email)` UNIQUE 許容、Phase 24 では `transport_order.company_id != vendor_users.company_id` で阻止 (tenant 境界)
4. **F1: `inviteUserByEmail` 採用** (password set link メール送信、Supabase 標準)
5. **F4: case (a) 完全新規のみ** (case (b) は Sprint γ で admin invitation と併せ検討)
6. **F8: ADR-0010 補項として明文化** (新 ADR-0011 ではなく既存補項)

## Invariants (絶対に壊さない)

- Phase 19/20/22 invariants 全継承
- `respond_to_transport_order(uuid,text,text)` RPC / `respondToTransportOrder` service / 6 error class 不変
- `withAuthenticatedDb` / `closeTransportOrderOnAllRejected` 不変
- `pnpm test` 70 → 増加のみ (新目標 82)
- 既存 raw-migrations 25 ファイル touch 禁止 (新規番号 26+)
- ADR-0010 service_role 境界遵守 (RPC 内 auth.admin 禁止)

## Sub-task 分解 (Phase 24)

### α. spot helper / RLS migration (`26_spot_helper_rls.sql`)

- recon #1 §3/§4 SQL diff
- **F7 反映**: 元 `vendor_select` (19_rls_policies.sql:376-378) は `vendor_id = current_vendor_id()` のみ。新 policy は **super-set 拡張** (`vendor_id OR bound_vendor_id OR spot email match`)。registered vendor の accept 後 row visibility も追加。本拡張は backward-compatible

DoD: SQL 適用後 `pnpm test` 70/70 維持、spot 行が email match vendor_user に visible、registered vendor の bound 後 row 引続き visible

### β. spot RPC migration (`27_spot_rpc.sql`)

- recon #1 §2 + onboarding-pipeline §7 = RPC は既存 vendor_user 前提のまま
- `current_vendor_user_id()` helper の `vendor_users.auth_user_id = auth.uid()` 解決を確認
- **F2 false positive**: `responded_at timestamptz` は 12_transport.sql:97 既存、ADD COLUMN 不要
- error codes: 22023 / P0002 / 42501 (case (c) cross-tenant) / 55P03 / P0001
- GRANT EXECUTE TO authenticated

DoD: SQL 適用後 spot accept/reject 動作、case (c) cross-tenant で 42501、`pnpm test` PASS

### γ. spot service (`src/lib/services/spot-invitations.ts`)

- recon #1 §5 シグネチャ
- 既存 6 error class import 再利用 (transport-orders.ts touch 禁止 = Phase 19 invariant)
- **新規追加 router function (advisor #2 対応)**:
  ```ts
  export async function respondToInvitation(db, input)
  // db.select で invitation.vendor_id 確認 → registered/spot 分岐
  ```

DoD: typecheck PASS、η 全 PASS、router 分岐動作

### δ-server. spot first-touch onboarding **server action のみ** (UI は Phase 25)

- `src/app/(vendor-portal)/vendor/invitations/[token]/onboard-action.ts` 新規 (UI なし server action)
- token spec (F3): raw token = `crypto.randomBytes(32).toString('base64url')` (256bit エントロピー)
- hash = `sha256(raw)` を `transport_order_invitations.invitation_token_hash` (12_transport.sql:158-159 UNIQUE constraint 既存) と照合
- raw token 生成位置: invitation 作成時 (今後 spot invitation 作成 service で生成、本 Phase 24 では生成位置の interface のみ定義、生成は seed/test fixture で代用)
- ε onboarding service 呼出

DoD: integration test で server action 経由 4 ケース (a)(c)(d) + expired token 動作

### ε. spot onboarding service (`src/lib/services/spot-onboarding.ts`)

`verifyAndOnboardSpotInvitation(supabaseAdmin, token): Promise<OnboardResult>`

処理 (case (a) (c) (d) のみ、case (b) は γ 繰越):
1. token SHA256 → `transport_order_invitations` SELECT (expires_at / response='pending')
2. 既存 `vendor_users` lookup: `SELECT WHERE lower(email) = lower(invitee_email)`
3. case 判定:
   - **(a) 完全新規** (vendor_user 不在): vendors INSERT → `auth.admin.inviteUserByEmail(invitee_email, { redirectTo })` → vendor_users INSERT (`is_active=false`, `auth_user_id = invite response.user.id`)
   - **(c) cross-tenant** (vendor_user 存在 + `vendor_users.company_id != transport_order.company_id`): `VendorCrossTenantError (409)`
   - **(d) same-tenant existing** (vendor_user 存在 + 同 company): そのまま return (login wall で session 確立)
4. **vendors row source (advisor #1)**:
   - `company_id` = transport_order.company_id 継承
   - `name` = `invitation.invitee_name` (NULL なら invitee_email 局所部 fallback)
   - `email` = invitation.invitee_email
   - `phone` = invitation.invitee_phone (nullable)
   - `notification_method` = 'both'、`is_shared` = false
5. **`vendor_users.is_active=false` 初期値 (F6)**: 明示 INSERT、login 成功後 Phase 25 で callback hook 経由 flip
6. **compensating action (advisor #3, F9 LOW)**:
   - precheck: `auth.admin.listUsers` で email 既存確認 (seed-vendor-dev:111 pattern、idempotent 第一段)
   - 失敗時逆順: vendors INSERT 失敗 → noop / inviteUserByEmail 失敗 → vendors DELETE / vendor_users INSERT 失敗 → auth.admin.deleteUser + vendors DELETE

DoD: case (a)(c)(d) + expired token + concurrent 4 ケース PASS

### η. integration test (`tests/integration/services/spot-invitations.integration.test.ts` 新規 +12)

case (a) happy accept / case (c) cross-tenant 拒否 / case (d) existing / reject + close 連動 / concurrent accept / mixed registered+spot / RLS visibility / DB constraint (vendor_id NULL + invitee_email NULL) / expired token / token hash mismatch / **router function: registered → respondToTransportOrder dispatch (F5)** / **router function: spot → respondToSpotInvitation dispatch (F5)**

DoD: `pnpm test` 70 → **82 PASS** (+12)

## ADR-0010 補項 (F8、spec/CLAUDE.md 追記要、user approve 済)

```
### ADR-0010 補項 (Phase 24 追加)

vendor invitation token verification/onboarding server route も service_role 利用境界に追加:
- 対象: `src/app/(vendor-portal)/vendor/invitations/[token]/*` 配下の server-only action
- 利用範囲: token hash 照合、`auth.admin.inviteUserByEmail`、`vendor_users` INSERT
- 制約: client component / RPC 内では service_role 利用禁止 (既存規律維持)
```

## Phase 25 (Sprint β Day 2) スコープ (本 plan に含めない)

- ζ. UI: actions.ts で `respondToInvitation` 呼出統合
- δ-ui. `/vendor/invitations/[token]/page.tsx` 実装 (token UI + password setup wall)
- login callback で `vendor_users.is_active=true` flip + `last_login_at` 更新 (F10)
- θ. E2E spec `vendor-portal-spot-loop.spec.ts` (2 ケース)
- ι. CI workflow + Supabase Branching (案 B)

## 段階分割 (Sprint β 全体)

| Phase | スコープ | DoD |
|---|---|---|
| **Phase 24 (本 plan)** | α/β/γ/δ-server/ε/η | spot MVP DB/service + 82/82 PASS |
| Phase 25 | ζ/δ-ui/θ/ι + login callback | UI + E2E ローカル + CI Branching |
| Phase 26 (γ 計画開始) | admin 事前招待 UI + case (b) + case (c) global unique 設計 | plan only |

## 委任戦略 (Phase 24)

| sub-task | 委任先 | 理由 |
|---|---|---|
| α/β | Codex 強制 | 定型 SQL + recon に skeleton |
| γ | Codex 委任候補 | 既存 transport-orders.ts pattern 流用 |
| δ-server | Codex 強制 | server action 新規、機械的 |
| ε | Codex 強制 | 4 ケース分岐 + compensating action 仕様明確 |
| η | Codex 強制 | spec 確定後の網羅テスト |

## Risks (実装中の主要 risk)

| risk | 緩和 |
|---|---|
| auth.admin SDK 例外多様性 | catch all + 逆順 cleanup、listUsers precheck |
| typecheck implicit any (Phase 20 教訓) | Codex prompt に型注釈テンプレ明示 |
| concurrent first-touch (同 token 2 並列) | listUsers 後 createUser 前 race → auth.users.email UNIQUE で抑制 + retry |
| `inviteUserByEmail` の redirectTo URL config | NEXT_PUBLIC_APP_URL + `/vendor/invitations/callback` 想定、Phase 25 で activate |
| spot RPC `current_vendor_user_id()` 解決 | 18_helper_functions.sql 実装確認、`auth_user_id = auth.uid()` で解決前提 |

## 次 Phase 入力契約 (Phase 25)

- Phase 24 全 sub-task 完了済 (spot MVP DB/service + 82/82 PASS)
- `respondToInvitation(db, input)` router 利用可能
- ε onboarding service が server-only で利用可
- `vendor_users.is_active=false` での INSERT pattern 確立済
- 参照: 本 plan v2 + 5 recon + adversarial-review + Phase 25 用 ι/ζ/δ-ui 設計

## 実装着手 Gate ✓

- [x] Codex (= advisor 代替) adversarial review 統合済
- [x] Open Q F1/F4/F8 user 判断取得済
- [x] ADR-0010 補項案文確定 (user approve 残)
- [x] plan v2 確定

**残: ADR-0010 補項を spec/CLAUDE.md に追記 (Phase 24 実装着手と並行可、α/β 実装は spec 追記前でも開始可能)**
