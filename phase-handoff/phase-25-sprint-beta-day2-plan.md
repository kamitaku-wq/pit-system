# Phase 25 / Sprint β Day 2 Plan v2: UI + E2E + CI Branching

> v1 → v2: adversarial review (Claude 代替、Codex sandbox-blocked) 10 findings 反映 + user 判断 3 件確定 (F3/F4/Q#4)。

## Plan Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 25 (Sprint β Day 2) |
| 状態 | **plan-v2 (実装着手可、ι は spike 後)** |
| 前 Phase | 24 (Sprint β Day 1) sealed |
| 関連 recon | phase-23-sprint-beta-recon-{spot,ci-e2e}.md + phase-23-recon-{spot-onboarding-pipeline,branching-migrations}.md + phase-24-adversarial-review.md + phase-25-adversarial-review.md |
| 根拠 | Phase 24 handoff + Claude adversarial review 10 findings + user 判断 6 件 |

## Goal

spot invitation UI エンドポイント (ζ-mw/ζ/δ-ui) + login callback での is_active flip (F10) + E2E spec 2 ケース (θ) + CI Branching MVP (ι) を完成させ、Sprint β の観測可能な動作を確立する。

## 確定済 user judgment (Phase 24 継承 + Phase 25 追加)

1. `inviteUserByEmail` 採用済み (Phase 24)、case (b) Sprint γ 繰越、case (c) VendorCrossTenantError 409
2. CI: Strategy A (Branching) MVP + raw-migrations 案 B (env 隔離)
3. `vendor_users.is_active=false` 初期値 (Phase 24 spot-onboarding.ts:286 確認済) + login 後 flip
4. **Q#1 → ζ-mw**: middleware に `/vendor/invitations/[token]` 未認証許可を追加 (BLOCKER 解消)
5. **Q#2**: callback URL は `/vendor/invitations/callback/route.ts` 新規 (spot-onboarding.ts:235 焼き込みを尊重)
6. **Q#3**: E2E bypass = seed `auth.admin.createUser({ email_confirm: true, password })` + `signInWithPassword`
7. **F3**: 冪等性は spot-onboarding.ts 内 vendors lookup で塞ぐ (ε-patch)
8. **F4**: spot 固有 error は新規 code `cross_tenant` を actions.ts switch に追加
9. **Q#4**: ι 着手前に ~30 分 spike で Branching DIRECT_URL verify、不可なら Strategy C fallback

## Invariants (絶対に壊さない)

- Phase 19/20/22/24 invariants 全継承
- `respondToTransportOrder` / `respondToSpotInvitation` / `respondToInvitation` / `verifyAndOnboardSpotInvitation` / `onboardSpotInvitationAction` 公開シグネチャ不変
- 既存 raw-migrations 27 ファイル touch 禁止 (Phase 25 は新規 migration 基本なし、ε-patch も非 DB)
- `withAuthenticatedDb` / ADR-0010 補項境界遵守
- `pnpm test` 82 → 増加のみ (新目標 ~88、ε-patch test +1, F10 +2, ζ +2, ζ-mw +1)

## Sub-task 分解

### ζ-mw. middleware patch (`src/middleware.ts`)

- `const isInvitationPath = pathname.startsWith("/vendor/invitations/")` 追加
- `!user && !isLoginPath && !isInvitationPath` に変更 (line 53)
- 既存 vendor portal route の認証強制は維持 (BLOCKER F1 解消)
- DoD: middleware unit test +1、token URL 未認証アクセスで login redirect が発生しないこと、`pnpm test` PASS

### ζ. `respondAction` を `respondToInvitation` router 経由

- 対象: `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts`
- import を `respondToTransportOrder` → `respondToInvitation` に差し替え (from `@/lib/services/spot-invitations`)
- **F4 実装結果 (plan v2.1)**: 実装中の確認で spot-invitations.ts (response 経路) も既存 6 error class のみ使用、VendorCrossTenantError は spot-onboarding.ts (onboarding 経路) 専用で actions.ts に到達しないことが確定。**F4 case 追加は不要、単純 import 差し替えのみ**
- DoD: typecheck PASS、`pnpm test` PASS、registered/spot 両 dispatch 動作

### F10. callback route (`src/app/vendor/invitations/callback/route.ts` 新規)

- 受信: `?code=...` (Supabase Auth PKCE)
- 処理: `supabase.auth.exchangeCodeForSession(code)` → user 取得 → `vendor_users WHERE auth_user_id = user.id` UPDATE: `is_active=true, last_login_at=now()` (1 UPDATE で atomic)
- **F5 対応**: RLS UPDATE policy を事前 verify (`19_rls_policies.sql` で `vendor_users` UPDATE policy 確認)。`is_active=false` 状態で自己 UPDATE が許可されない場合は service_role 経由に切替 (ADR-0010 補項対象 route として明示)
- redirect 先: `/vendor/requests`
- DoD: callback 経由 login で `is_active=true` flip + `last_login_at` 更新、`pnpm test` +2 (RLS 越し / service_role 経路)

### δ-ui. `/vendor/invitations/[token]/page.tsx` 実装

- Server Component で `onboardSpotInvitationAction(token)` を server-side await
- case 表示分岐:
  - `code: 'INVITATION_TOKEN_INVALID'` → token 無効/期限切れ表示
  - `code: 'VENDOR_CROSS_TENANT'` → cross-tenant 拒否表示
  - `result.case === 'new'` → 「招待メール送信。リンクから password 設定」案内
  - `result.case === 'existing'` → 「ログインしてください」+ `/vendor/login` リンク
- 冪等性は ε-patch 側で塞ぐため page.tsx は単純 GET で OK
- DoD: token URL アクセスで case 別 UI 表示、`pnpm test` PASS

### ε-patch. spot-onboarding 冪等性対応 (`src/lib/services/spot-onboarding.ts`)

- **F3 対応**: case (a) 入口で `vendors WHERE email = invitee_email AND company_id = transport_order.company_id` lookup
- 既存 row があれば INSERT skip、findAuthUserByEmail 経路で auth.users 既存確認 + vendor_users 既存確認 → existing as case 'new' (再 onboarding 扱い) で return
- 既存テスト 82 PASS 維持 (非破壊変更)
- DoD: page.tsx 2 回 GET で vendors INSERT 重複なし、test +1 (冪等性 case)

### θ. E2E spec (`tests/e2e/vendor-portal-spot-loop.spec.ts` 新規)

- 2 ケース: case (a) happy / case (c) cross-tenant
- seed helper 分離: `_helpers/seed-vendor-spot-e2e.ts` (case a) + `_helpers/seed-vendor-cross-tenant-e2e.ts` (case c)
- case (a) bypass: seed で `supabaseAdmin.auth.admin.createUser({ email_confirm: true, password: '<test-temp>' })` + Playwright `signInWithPassword` (実メール送信なし)
- 既存 `vendor-portal-loop.spec.ts` seed pattern (UUID 隔離 + afterAll cleanup) 踏襲
- DoD: `pnpm playwright test` でローカル 2 ケース PASS

### ι. CI workflow + Supabase Branching (案 B)

**実装着手 Gate: DIRECT_URL spike 完了**

spike (~30 分): preview branch 手動作成 → connection string 取得 → port 5432 (DIRECT) verify。
- 取れる場合: 案 B 続行
- 取れない場合: Strategy C (dedicated staging DB) に切替、`.github/workflows/e2e.yml` 内 secret を staging URL 固定

実装:
- `.github/workflows/e2e.yml` 新規 (recon §4 skeleton)
- `supabase/config.toml` 最小生成 (案 B 採用時)
- `supabase/migrations/` 空 → 起動失敗時は dummy noop SQL を置く
- CI flow: checkout → pnpm → playwright install → apply-raw-sql.ts → pnpm dev → wait-on → pnpm test:e2e → artifact upload
- DoD: PR で workflow trigger + E2E 2 ケース PASS + artifact 確認

## 実装順序 (依存順)

1. **ζ-mw** (middleware patch、δ-ui 動作前提)
2. **ζ** (actions.ts router + cross_tenant code)
3. **F10** (callback route、RLS verify 含む)
4. **ε-patch** (冪等性、δ-ui 前)
5. **δ-ui** (page.tsx)
6. **θ ローカル** (E2E 2 ケース、CI なしで先行)
7. **ι** (DIRECT_URL spike → workflow)

## 委任戦略

| sub-task | 委任先 | 理由 |
|---|---|---|
| ζ-mw | Codex 強制 | 機械的 patch + test |
| ζ | Codex 強制 | import 差し替え + case 追加 |
| F10 | Claude (RLS 判断) → Codex 実装 | RLS verify は Claude、route 本体は委任 |
| ε-patch | Codex 強制 | lookup 追加 + test +1 |
| δ-ui | Codex 強制 | Server Component + case 分岐 |
| θ | Codex 強制 | E2E + seed pattern 既存踏襲 |
| ι spike | Claude | 手動 verify (実環境判断) |
| ι 実装 | Codex 委任 → Claude レビュー | YAML 骨格は機械的、Branching/Strategy C 選択は Claude |

## Risks (Phase 25 主要)

| risk | 緩和 |
|---|---|
| middleware patch で既存 vendor portal 認証が緩む | matcher 配下で `isInvitationPath` のみ追加、他 path 影響なし、test で verify |
| callback RLS UPDATE 不可 (F5) | spike で確認、不可なら service_role 経由 (ADR-0010 補項適用) |
| E2E createUser 経路で auth.users 残留 | afterAll cleanup で `auth.admin.deleteUser` 必須 |
| DIRECT_URL 不可 (Q#4) | spike 結果次第で Strategy C fallback、CI workflow secret 切替のみで対応可 |
| `supabase/migrations/` 空起動失敗 | dummy noop SQL 即時設置 (recon §9 workaround) |

## 残 Open Q (ι 着手前 spike 結果次第)

1. **Branching DIRECT_URL 取得可否** → spike で確定
2. **空 `supabase/migrations/` で Branching 起動可否** → spike 同時 verify

## 段階分割

| Phase | スコープ | DoD |
|---|---|---|
| **Phase 25 (本 plan)** | ζ-mw/ζ/F10/ε-patch/δ-ui/θ/ι | UI + E2E ローカル + CI Branching (or Strategy C) |
| Phase 26 (Sprint γ 開始) | admin 事前招待 UI + case (b) + case (c) global unique 設計 + 統一 callback refactor | plan only |

## 次 Phase 入力契約 (Phase 26)

- spot invitation E2E ローカル + CI 動作確認済 (θ/ι)
- `vendor_users.is_active` flip 経路確立 (F10、RLS or service_role どちらかで確定)
- 冪等性: spot-onboarding 内 vendors lookup で塞がれた
- case (b) / case (c) global unique 設計: Phase 26 スコープ
- admin invitation UI 設計: Phase 26 plan で開始

## 実装着手 Gate ✓

- [x] Adversarial review 完了 (10 findings)
- [x] user 判断取得 (F3/F4/Q#4 + 推奨採択 3 件)
- [x] plan v2 確定
- [ ] **ι 着手前**: DIRECT_URL spike (~30 分) — ι 以外の sub-task は spike 不要

**残: ι 以外は実装着手可。ζ-mw → ζ → F10 → ε-patch → δ-ui → θ (ローカル) → spike → ι の順で進める。**
