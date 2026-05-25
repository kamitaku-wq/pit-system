# Phase 25 / Sprint β Day 2 partial-sealed: UI + F10 callback (ι 残)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 25 (Sprint β Day 2) |
| 状態 | **partial-sealed** (ζ-mw/ζ/ε-patch/F10 route/δ-ui/θ-files 完了、F10 test 2 skip、ι 残) |
| 前 Phase | 24 (Sprint β Day 1) sealed |
| 次 Phase | 25 続き or 26 (DB schema 乖離調査 + ι spike + workflow + skipped test 再活性化) |
| 関連 plan | phase-25-sprint-beta-day2-plan.md v2.1 |
| 関連 review | phase-25-adversarial-review.md (Claude 代替、Codex sandbox-blocked) |

## 達成したこと

- **ADR-0010 補項 minor 拡張** (`spec/CLAUDE.md:131-138`): `[token]/*` → `(vendor-portal)/vendor/invitations/**`、callback での `vendor_users.is_active` flip + `last_login_at` 更新を境界内に
- **ζ-mw** (`src/middleware.ts:50-53`): `/vendor/invitations/*` 未認証 carve-out 追加 (F1 BLOCKER 解消)
- **ζ** (`src/app/(vendor-portal)/vendor/requests/[id]/actions.ts`): `respondToTransportOrder` → `respondToInvitation` router 差し替え。F4 case 追加は実装中の確認で不要と判明 (spot-invitations.ts も既存 6 error class のみ throw、`VendorCrossTenantError` は onboarding 経路専用)
- **ε-patch** (`src/lib/services/spot-onboarding.ts:236-280`): F3 冪等性 — `vendors WHERE email AND company_id` lookup を追加、既存 row を再利用 (`reusedVendorId` 経路、`createdVendorId` は cleanup tracking のみ)
- **F10 callback route** (`src/app/(vendor-portal)/vendor/invitations/callback/route.ts`): GET, `exchangeCodeForSession` → drizzle db (postgres user, RLS bypass) で `vendor_users` UPDATE `is_active=true, last_login_at=now()`。エラー時 `/vendor/login?error=<reason>` redirect
- **δ-ui** (`src/app/(vendor-portal)/vendor/invitations/[token]/page.tsx`): Server Component、`onboardSpotInvitationAction(token)` 結果で 5 case 分岐 UI
- **θ E2E spec + seed helpers** (3 files): case (a) happy / case (c) cross-tenant、UUID 隔離 + idempotent cleanup、auth.users 先作成で実メール送信回避 (Playwright 未実行)
- **integration test +2 active** (`pnpm test`): **82 → 84 PASS** (ε-patch idempotency +1 / callback invalid_callback +1)

## Claude 側の主要設計判断

- F5 (vendor_users RLS UPDATE) verify: `tenant_isolation` policy は `current_user_company_id()` (= `public.users`) 越し → vendor portal user は NULL → RLS UPDATE 不可。**A 案採択**: drizzle db (postgres user, RLS bypass) 経由 + ADR-0010 補項 minor 拡張で対応 (新規 migration 不要、Phase 25 invariant 維持)
- callback URL は `spot-onboarding.ts:235` 焼き込み `/vendor/invitations/callback` を尊重 → route 配置は `(vendor-portal)/vendor/invitations/callback/route.ts` (Q#2 = B 案)
- F4 verify: `spot-invitations.ts:117-132` で 6 既存 error class のみ throw、`VendorCrossTenantError` は `spot-onboarding.ts` (onboarding) 専用 → ζ は import 差し替えのみ
- typecheck 修正 1 件: `vendorIdToUse = createdVendorId` ($string | null$) を `createdVendor.id` ($string$) 直接代入に
- Codex Write 委任: callback + page.tsx (3 回 hook block で persistent escalation 経由) / θ E2E + seed / 新規 test 4 件 → 3 task 全成功 (前回 sandbox-blocked の adversarial review と異なり、Write 経路は別 sandbox で動作)

## Codex 委任成果 (ledger ID)

| sub-task | delegation_id | 状態 |
|---|---|---|
| adversarial review | del-20260525-031448-088e | rejected (sandbox-blocked) |
| callback route + page.tsx | del-20260525-034030-8c32 | applied |
| θ E2E spec + seed helpers | (Task 内、ledger 確認) | applied |
| 新規 test +4 (ε-patch +1 / F10 +3) | (Task 内、ledger 確認) | applied (うち 2 skip 化) |

## 主要ファイル

- `spec/CLAUDE.md:131-138` — ADR-0010 補項 (Phase 25 minor 拡張)
- `src/middleware.ts:50-53` — invitation path carve-out
- `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts:1-16, 46` — router 差し替え
- `src/lib/services/spot-onboarding.ts:236-280` — ε-patch 冪等性 lookup
- `src/app/(vendor-portal)/vendor/invitations/callback/route.ts:1-41` (new) — F10 callback
- `src/app/(vendor-portal)/vendor/invitations/[token]/page.tsx:1-65` (new) — δ-ui
- `tests/integration/app/vendor-invitation-callback.integration.test.ts:1-176` (new) — F10 test (3 件、2 skip)
- `tests/e2e/vendor-portal-spot-loop.spec.ts` (new) — θ E2E
- `tests/e2e/_helpers/seed-vendor-spot-e2e.ts` (new)
- `tests/e2e/_helpers/seed-vendor-cross-tenant-e2e.ts` (new)

## データモデル変更

- なし (Phase 25 は新規 migration を入れずに完遂、invariant 維持)

## API 契約

- `GET /vendor/invitations/callback?code=<auth-code>` → `vendor_users.is_active=true` flip + `last_login_at` 更新 → redirect `/vendor/requests`
- エラー redirect: `/vendor/login?error={invalid_callback|callback_failed|vendor_user_not_found}`
- `respondToInvitation` router 経路 (Phase 24 既存) を actions.ts が利用

## テスト・QA 状況

- `pnpm test`: **84 PASS / 2 skipped (86 total)** — 既存 82 + ε-patch idempotency +1 + callback invalid_callback +1
- `pnpm tsc --noEmit`: clean
- 新規 active test: ε-patch idempotency 1 / callback code missing 1
- **skip (Phase 26 繰越)**: callback happy_path / vendor_user_not_found — 理由は次節 TODO
- E2E (Playwright): ローカル未実行 (実行は ι spike 完了後の CI で初回回帰)

## 既知の懸念・TODO (Phase 26 で対応)

- **【最優先】DB schema 乖離**: `public.vendors` 実 DB が PoC 期 10 列 (id/company_id/code/name/contact_email/contact_phone/status/timestamps) のまま、drizzle schema (`09_vendors.sql` 16 列、contact_person_name 等あり) と不一致。`pit_v24_poc.vendors` という別 schema も存在。callback test の vendors INSERT で trigger 内 `to_jsonb(NEW)` が contact_person_name を要求して failure。既存 spot-invitations test は `withRollback` で同事象がエラーログに出ない可能性。Phase 26 で:
  1. `apply-raw-sql.ts` の適用先と引数を確認
  2. `public.vendors` を新 schema に再構築 (data 退避 → DROP → CREATE → restore のシーケンス)
  3. `pit_v24_poc` schema の扱い決定 (廃止 or 残置)
  4. skipped test 2 件を active 化
- **ι (Phase 25 残)**:
  - spike (~30 分): Supabase preview branch を手動作成 → DIRECT_URL (port 5432) 取得可否を verify。不可なら Strategy C fallback
  - workflow (`.github/workflows/e2e.yml`) 実装、`supabase/config.toml` 最小生成、`supabase/migrations/` dummy noop SQL
- θ Playwright ローカル実行: case (a) inviteUserByEmail bypass の動作確認 (seed の `createUser + signInWithPassword`)
- bound visibility 直接シナリオ test (Phase 24 review 繰越) は θ で間接的にカバー予定だが Playwright 実行で verify

## 次 Phase 入力契約 (Phase 25 続き or Phase 26)

- 利用可能 API: callback route `/vendor/invitations/callback`、ζ 経由 respondToInvitation、ε-patch 済み verifyAndOnboardSpotInvitation (冪等)
- 必要 env: `NEXT_PUBLIC_APP_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` / `DIRECT_URL`
- スコープ: DB schema 反映 → skipped test 2 件再活性化 → ι spike → ι workflow
- 参照: 本 partial-handoff + plan v2.1 + phase-25-adversarial-review.md

## Invariants 継承

- Phase 19/20/22/24 invariants 全継承 → 守られた
- 既存 raw-migrations 27 ファイル touch なし → 守られた
- `respondToTransportOrder` / `respondToSpotInvitation` / `respondToInvitation` / `verifyAndOnboardSpotInvitation` / `onboardSpotInvitationAction` 公開シグネチャ不変 → 守られた
- ADR-0010 service_role 境界 → 補項を minor 拡張 ((vendor-portal)/vendor/invitations/** に統一)
- pnpm test 増加のみ → 82 → 84 (PASS 増、skip 2 件は不算入)

## 主要メトリクス

- Codex 委任率: 4/5 Task 委任 (Phase 25 内のサブタスク 7 件中、4 件を Codex Write/E2E/test 委任、ζ-mw + ζ + ε-patch + ADR 補項 + typecheck 修正は Claude)
- typecheck 修正は Claude (1 件、1 行)
- 累計セッション時間: 計画 + 実装 + Codex 委任で 1 段階セッション内完遂 (中間 seal)
- Codex sandbox 失敗 1 回 (adversarial review、Read 経路) → Claude 代替で品質維持
- Codex Write 経路は 3 件全成功 (sandbox profile が Read と異なる可能性、要観察)
