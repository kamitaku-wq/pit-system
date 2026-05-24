# Phase 21 / 16-E Playwright E2E Recon

## 1. Playwright 依存・config 現状 (なし/あり, version, 設定ファイル絶対パス)

- あり: `package.json` devDependencies に `@playwright/test: ^1.52.0`。`playwright` は direct devDependency なし。
- lockfile resolved: `pnpm-lock.yaml` では `@playwright/test@1.60.0`、依存 `playwright: 1.60.0`。
- npm script あり: `"test:e2e": "playwright test"`。
- config あり: `C:\Users\kamit\dev\pit_system\playwright.config.ts`。
- config 内容: `testDir: "./tests/e2e"`、Chromium のみ、CI retry 2、trace on-first-retry、screenshot only-on-failure。
- webServer: `pnpm dev`、URL `http://localhost:3000`、`PLAYWRIGHT_BASE_URL` で baseURL override、`PLAYWRIGHT_SKIP_WEBSERVER` で webServer 無効化。
- 既存 E2E dir: `tests/e2e/` は存在するが spec file なし。`e2e/` と `__e2e__/` は not found。
- config search result: `playwright.config.ts` のみ。

## 2. 既存テスト構造との衝突点・共有可能 fixture

- Vitest config: `C:\Users\kamit\dev\pit_system\vitest.config.ts`。
- Vitest include: `tests/unit/**/*.{test,spec}.{ts,tsx}` と `tests/integration/**/*.{test,spec}.{ts,tsx}`。
- Vitest exclude: `tests/e2e` が明示除外済み。Playwright spec 追加による Vitest 衝突は低い。
- Vitest setupFiles: `[]`。globalSetup / setup file は not found。
- integration layout:
  - `tests/integration/tenant-isolation.test.ts`
  - `tests/integration/record-audit-log.test.ts`
  - `tests/integration/poc-11-turnstile.test.ts`
  - `tests/integration/services/transport-orders.integration.test.ts`
  - `tests/_helpers/seed-transport-statuses.ts`
- 共有候補: `tests/_helpers/seed-transport-statuses.ts` は Drizzle tx で `requested/accepted/rejected` と transition を seed するため、16-E の transport order fixture に流用可能。
- integration は `.env.local` を dotenv load し、`DIRECT_URL ?? DATABASE_URL` で DB 接続、transaction rollback pattern を多用。
- `transport-orders.integration.test.ts` 内に `seedBaseFixture` / `seedVendorUser` / `setAuthUid` があるが file-local。E2E で使うなら helper 抽出が必要だが、本 recon では未変更。
- E2E 対象 UI は role/label で最低限操作可能: login email/password labels、一覧 link、詳細の `承諾` / `辞退` button。
- `RespondForm` に `data-transport-order-id` はあるが invitation 用 data-testid はなし。16-E 実装時は selector 方針を先に決めること。

## 3. CI/env 現状と必要な追加

- CI: `.github/workflows/*.yml` / `*.yaml` は rg search で not found。E2E 実行 step は現状なし。
- `.env.example` あり、`.env.local.example` は not found。
- `.env.example` の E2E 関連:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DATABASE_URL`
  - `DIRECT_URL`
  - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  - `TURNSTILE_SECRET_KEY`
  - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
  - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- Playwright config/env 追加候補:
  - `PLAYWRIGHT_BASE_URL` for CI/staging target
  - `PLAYWRIGHT_SKIP_WEBSERVER=1` for external server smoke
  - E2E seed 用に `DATABASE_URL` or `DIRECT_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` が必須
  - browser auth には app runtime 側で `NEXT_PUBLIC_SUPABASE_ANON_KEY` も必須
- CI 追加が必要なもの: pnpm install、Playwright browser install、DB/env secret provision、`pnpm seed:vendor-dev` or dedicated E2E seed、`pnpm test:e2e`。

## 4. 16-E E2E test 着手に必要な setup タスク (序列付き、所要時間目安)

1. E2E fixture 方針確定 (30-45m): `scripts/seed-vendor-dev.ts` を使うか、spec-local/helper で order + invitation まで seed するか決める。
2. DB seed helper 作成/抽出 (60-90m): transport order, pending invitation, vendor A/B auth users, statuses/transitions を idempotent or cleanup 可能にする。
3. Playwright auth helper 作成 (30-45m): `/vendor/login` で `vendor-dev1@example.com` / `vendor-dev-pass-001` login、または storageState 化。
4. `tests/e2e/vendor-portal-loop.spec.ts` skeleton (45-60m): happy path, RLS漏洩 notFound, double submit の 3 ケースに分割。
5. cleanup/namespace 設計 (30-45m): order_number prefix や test UUID で後片付け可能にする。既存 Vitest rollback は browser 経路では使えない。
6. CI wiring (45-60m): workflow 追加、browser install/cache、secrets、`PLAYWRIGHT_BASE_URL`/webServer 方針。
7. flaky 対策 (30m): form double submit は network/DB outcome assertion に寄せ、UI timing 依存を減らす。

## 5. 推奨アプローチ (Playwright 単独 / playwright-mcp 統合 / 既存 vitest との分離方針)

- 推奨: Playwright 単独。既に `@playwright/test` と `playwright.config.ts` と `test:e2e` が揃っている。
- playwright-mcp 統合は不要。現時点の目的は repeatable CI spec であり、MCP は探索用途に留めるのがよい。
- Vitest とは分離維持。`vitest.config.ts` が `tests/e2e` を exclude 済みなので、E2E は `tests/e2e/vendor-portal-loop.spec.ts` に置く。
- fixture は Vitest の file-local helper を直接 import しない。共有するなら `tests/_helpers/` に DB helper として明示抽出する。
- `scripts/seed-vendor-dev.ts` は dev/staging seed として有用だが、order/invitation は作らないため E2E 専用 seed が別途必要。

## 6. 警告・既存変更してはいけないもの

- 既存 66 Vitest tests は触らない。`tests/integration/**` と `tests/unit/**` の挙動を変えない。
- `package.json`, `vitest.config.ts`, `tsconfig.*`, `.github/**`, 既存 test files は本 recon では未変更。
- Phase 20 handoff lines 56-82 の主要新規 files は 16-E の前提:
  - `src/lib/db/with-auth.ts`
  - `src/lib/supabase/server.ts`
  - `src/lib/supabase/browser.ts`
  - `src/middleware.ts`
  - `src/app/(vendor-portal)/layout.tsx`
  - `src/app/(vendor-portal)/vendor/login/page.tsx`
  - `src/app/(vendor-portal)/vendor/login/actions.ts`
  - `src/app/(vendor-portal)/vendor/requests/page.tsx`
  - `src/app/(vendor-portal)/vendor/requests/[id]/page.tsx`
  - `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts`
  - `src/components/vendor-portal/vendor-shell.tsx`
  - `src/components/vendor-portal/request-list-item.tsx`
  - `src/components/vendor-portal/respond-form.tsx`
  - `scripts/seed-vendor-dev.ts`
- 壊してはいけない invariant: `withAuthenticatedDb(authUserId, fn)` signature、middleware matcher `/vendor/:path*`、seed credentials `vendor-dev1@example.com` / `vendor-dev-pass-001`、6 error code names。
- 注意: existing `tests/e2e/` は empty だが config は有効。spec を追加すると `pnpm test:e2e` が即実行対象になる。
