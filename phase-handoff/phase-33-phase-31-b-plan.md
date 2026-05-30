# Phase 31-B 実装プラン

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | Phase 31-B |
| 状態 | PLAN (Phase 31-A sealed) |
| 作成日 | 2026-05-25 |
| 前 handoff | `phase-32-phase-31-a-foundation-sealed.md` |
| Source of truth | `phase-23-sprint-beta-recon-admin-invite.md` §4-5 案 B |

## DoD

1. `admin_vendor_invitations` テーブル DB 適用済み (`post/0010_admin_vendor_invitations.sql`)
2. admin が `/admin/vendors/invite` フォームから送信 → `createAdminVendorInvitation` service が Supabase auth invite メール送信
3. 招待 vendor user がリンク click → `app/(vendor-portal)/vendor/admin-invite-callback/route.ts` が `vendor_users.is_active=true` + `admin_vendor_invitations.status='accepted'` 更新
4. vitest ≥ 95 PASS / typecheck clean (新規テスト ≥ 4 件)
5. 既存 invariant 全件維持 (CI E2E 4 passed / tenant-isolation PASS / 公開 API シグネチャ不変)

## 設計判断

### D-1: `admin_vendor_invitations` スキーマ
`id` uuid PK / `company_id` uuid NOT NULL FK companies (spec §0-1) / `vendor_id` uuid NOT NULL FK vendors ON DELETE CASCADE / `invited_by_user_id` uuid FK users ON DELETE SET NULL / `email` text NOT NULL / `name` text / `role` text DEFAULT 'vendor_admin' CHECK IN ('vendor_admin','vendor_member') / `status` text DEFAULT 'pending' CHECK IN ('pending','sent','accepted','expired','revoked') / `token_hash` text UNIQUE / `expires_at` `sent_at` `accepted_at` timestamptz / `vendor_user_id` uuid FK vendor_users ON DELETE SET NULL (accept 後 UPDATE) / `created_at` `updated_at` timestamptz NOT NULL.
UNIQUE partial index: `(vendor_id, email) WHERE status='pending'` (重複防止)

### D-2: migration ファイル配置
`src/lib/db/raw-migrations/post/0010_admin_vendor_invitations.sql`。alpha-1-public 27/28/29 touch 禁止 (invariant)、handoff 指定「post/0010+」遵守。post/ 最新は 0008、0009 は reserved。

### D-3: server action signature
```ts
// src/lib/services/admin-vendor-invitations.ts
createAdminVendorInvitation(
  adminUser: AdminUser,
  input: { vendorId: string; email: string; name: string; role?: "vendor_admin" | "vendor_member" }
): Promise<{ invitationId: string; status: "sent" }>
```
処理順 (drizzle.transaction 内): vendor SELECT + company_id 一致チェック → pending 重複チェック (409) → `supabaseAdmin.auth.admin.listUsers` で既存 auth user 確認 → `inviteUserByEmail` → vendor_users INSERT → invitations INSERT → notification_outbox INSERT。auth 失敗時 `deleteUser` 補償 (`spot-onboarding.ts:128-148` 同パターン)。

### D-4: service_role client 共通化
`src/lib/supabase/admin.ts` 新規作成。`onboard-action.ts:27-41` のインライン `createClient` を抽出。`SUPABASE_SERVICE_ROLE_KEY`。ADR-0010 補項 (`spec/CLAUDE.md:131-137`) に admin invite パス追記。

### D-5: accept callback flow
`src/app/(vendor-portal)/vendor/admin-invite-callback/route.ts` (GET)。既存 `vendor/invitations/callback/route.ts:13-41` と同構造 (`exchangeCodeForSession` → authUserId)。追加: `admin_vendor_invitations` を authUserId 経由 (vendor_users.id) で SELECT → `status='accepted', accepted_at=now()` UPDATE。service_role で RLS バイパス。`(admin)` group 外配置必須 (認証前アクセス)。

### D-6: RLS policy
`post/0010_*` 内。`tenant_isolation (company_id = current_user_company_id())` FOR ALL TO authenticated。vendor portal は `current_user_company_id()` が users テーブル参照 (`18_helper_functions.sql:9-22`) のため事実上不可。callback route は service_role バイパス。

### D-7: invite form UI
Route: `src/app/(admin)/vendors/invite/page.tsx`。Server Component + `<form action={createAdminVendorInvitationAction}>`。フィールド: vendor `<Select>` (DB fetch) + email + name + role。shadcn `Select/Input/Button`。Zod validation は action 内。`useActionState` でエラー表示。

### D-8: エラー処理
重複 pending → 409 form エラー / cross-tenant vendor → 403 / auth API 失敗 → TX rollback + 補償削除 / callback token 無効 → `redirect('/vendor/login?error=invalid_callback')`

## 実装 Steps

| # | 内容 | ファイル | 委任 | 並列 |
|---|---|---|---|---|
| S1 | migration SQL (テーブル + RLS) | `raw-migrations/post/0010_admin_vendor_invitations.sql` | Claude (HIGH stake) | — |
| S2 | Drizzle schema | `schema/admin_vendor_invitations.ts` + `schema/index.ts` | Claude (S1 依存) | S1 後 |
| S3 | Supabase admin client | `lib/supabase/admin.ts` | Claude (ADR-0010) | S1 と並列可 |
| S4 | service 関数 + Error クラス | `lib/services/admin-vendor-invitations.ts` | Claude (auth TX) | S2+S3 後 |
| S5 | accept callback route | `app/(vendor-portal)/vendor/admin-invite-callback/route.ts` | Claude (auth callback) | S4 と並列可 |
| S6 | server action wrapper | `app/(admin)/vendors/invite/actions.ts` | Codex (~20 行) | S4 後 |
| S7 | invite form page | `app/(admin)/vendors/invite/page.tsx` | Codex (UI BP) | S6 後 |
| S8 | vendors page に招待ボタン | `app/(admin)/vendors/page.tsx` | Codex (placeholder 改修) | S7 と並列可 |
| S9 | unit tests | `tests/unit/lib/services/admin-vendor-invitations.test.ts` | Codex (強制: tests/) | S4 後、並列可 |
| S10 | tenant-isolation test + ADR-0010 補項 | `tests/integration/tenant-isolation.test.ts` + `spec/CLAUDE.md` | Codex (定型) | 任意時点 |

## 影響範囲

**新規 (8)**: migration SQL / Drizzle schema / `lib/supabase/admin.ts` / service / invite page / actions / admin-invite-callback / unit test
**変更 (4)**: `schema/index.ts` / `(admin)/vendors/page.tsx` / `spec/CLAUDE.md` / `tests/integration/tenant-isolation.test.ts`

## テスト計画

| 種別 | 対象 | 内容 | 担当 |
|---|---|---|---|
| unit | service | happy / cross-tenant 403 / duplicate 409 / auth failure rollback | Codex |
| unit | callback | valid / missing code / not found | Codex |
| integration | tenant-isolation | cross-tenant SELECT → 0 行 | Codex |
| E2E | full flow | invite → accept → /vendor/requests | Phase 31-C スコープ |

追加 ≥ 4 件 (91 → ≥ 95 PASS)

## リスクと前提

- **R-1: vendor_users trigger** — `enforce_vendor_user_tenancy()` (`spec/data-model.md:237-252`) が `vendor_users.company_id == vendors.company_id` 強制。S4 で vendor SELECT して company_id を INSERT に渡す
- **R-2: inviteUserByEmail idempotency** — 既存 email の挙動要確認。`spot-onboarding.ts:87-113` の `findAuthUserByEmail` パターンで事前チェック、既存なら invite skip して vendor_users INSERT のみ
- **R-3: tenant_isolation** — vendor portal ユーザーは `current_user_company_id()` NULL のため直接アクセス不可、設計通り。S10 で test 追加
- **R-4: rollback** — `inviteUserByEmail` は drizzle TX 外副作用。失敗時 `deleteUser` 補償 + drizzle 自動 rollback (`spot-onboarding.ts:128-148` パターン)
- **R-5: vendor_user_id SET タイミング** — 招待時 NULL、accept callback で UPDATE (service_role、`is_active=true` と同 UPDATE)

## 委任分類サマリ

**Claude 直接** (S1-S5 ~220 行): migration SQL / Drizzle schema / admin Supabase client / service / callback
**Codex 委任** (S6-S10 ~230 行): action wrapper / form page / vendors page / unit tests (強制) / tenant-isolation + ADR
委任率予測: ~51%

## 想定 commit

| commit | 内容 | diff |
|---|---|---|
| feat(phase-31-b): migration + schema | S1-S2 | ~70 |
| feat(phase-31-b): admin client + service + callback | S3-S5 | ~180 |
| feat(phase-31-b): invite form + vendors page | S6-S8 | ~100 |
| test(phase-31-b): unit + tenant-isolation | S9-S10 | ~80 |
| docs(phase-31-b): ADR-0010 補項拡張 | S10 末 | ~10 |

合計 ~440 行 / commit 5 件

## 絶対に壊してはいけない invariants

- vitest 91 PASS / typecheck clean / CI E2E 4 passed
- alpha-1-public 27/28/29 touch 0 (新規は `post/0010+` のみ)
- 公開 API: `respondToInvitation` / `respondToSpotInvitation` / `respondToTransportOrder`
- `tests/integration/tenant-isolation.test.ts:105-110` vendors invariant
- `getAdminUser()` signature (`src/lib/auth/admin-role.ts:9-13`)
- middleware admin matcher + `?next=` (`src/middleware.ts:50-66`)
- ADR-0010 補項 (拡張のみ可、縮小禁止)

## 参照ファイル (実装時必読)

- `phase-32-phase-31-a-foundation-sealed.md` — 入力契約・invariant
- `phase-23-sprint-beta-recon-admin-invite.md:36-79` — 案 B 設計 source of truth
- `spec/CLAUDE.md:131-137` — ADR-0010 補項 (拡張対象)
- `spec/data-model.md:218-253` — vendor_users DDL + trigger
- `src/lib/db/raw-migrations/alpha-1-public/09_vendors.sql:36-49` — vendor_users 実 DDL (spec §3.6 より優先)
- `src/lib/services/spot-onboarding.ts:87-148` — auth.admin + compensating cleanup
- `src/app/(vendor-portal)/vendor/invitations/callback/route.ts` — callback 参照実装
- `src/app/(vendor-portal)/vendor/invitations/[token]/onboard-action.ts:27-41` — service_role client パターン

---

*Generated by planner agent at 2026-05-25*
*Phase 31-C スコープ: vendors list / resend / revoke / E2E / 監査ログ*
