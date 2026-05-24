# Question 1: Next.js version + app router config

- `package.json:52` declares `"next": "^15.3.3"`; `pnpm-lock.yaml:4299` resolves the direct app dependency to `next@15.5.18` (there is also transitive `next@15.1.2` at `pnpm-lock.yaml:4277`).
- App Router is in use via `src/app/*`: root layout at `src/app/layout.tsx:9`, home page at `src/app/page.tsx:1`, admin route group at `src/app/(admin)/layout.tsx:9`.
- `next.config.ts:3-11` only sets strict mode, typed routes, server action body limit, fetch logging, and `poweredByHeader: false`.

```ts
// next.config.ts:3-8
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
```

- No `middleware.ts` currently exists (`rg --files | rg 'middleware\.ts'` returned no matches), so there is no matcher/session-refresh config yet.

# Question 2: Existing Drizzle + Supabase pattern

- Runtime Drizzle client is `src/lib/db/client.ts:4-14`, using `DATABASE_URL` and `postgres(databaseUrl, { prepare: false })`.

```ts
// src/lib/db/client.ts:4-14
const databaseUrl = process.env.DATABASE_URL;
const queryClient = postgres(databaseUrl, { prepare: false });
export const db = drizzle(queryClient);
export type DB = typeof db;
```

- Migrations use `DIRECT_URL ?? DATABASE_URL` in `drizzle.config.ts:11-20`; comments say runtime uses pooler `DATABASE_URL`, migration/direct SQL uses `DIRECT_URL` (`drizzle.config.ts:7-10`).
- No Supabase JS auth client is used by Drizzle. `SUPABASE_SERVICE_ROLE_KEY` exists only in `.env.example:15`; `rg` found no runtime service-role client in `src` or `tests`. Existing DB URLs are direct Postgres credentials, not anon/user-JWT clients.
- Phase 18/19 test status: `phase-handoff/phase-19-alpha-3-day2-16c.md:27` says `pnpm test` was `63/63 PASS`.
- Integration DB connections:
  - `tests/integration/tenant-isolation.test.ts:9-14` uses `DIRECT_URL ?? DATABASE_URL` with raw `postgres()`.
  - `tests/integration/record-audit-log.test.ts:9-14` uses `DIRECT_URL ?? DATABASE_URL` with raw `postgres()`.
  - `tests/integration/services/transport-orders.integration.test.ts:33-35` uses `DIRECT_URL ?? DATABASE_URL`, then `drizzle(queryClient)`.
- RLS auth is simulated in tests by setting local role/JWT claims:

```ts
// tests/integration/tenant-isolation.test.ts:67-78
await tx`SET LOCAL ROLE authenticated`;
await tx.unsafe(`SET LOCAL request.jwt.claims = '${claims(sub)}'`);
```

```ts
// tests/integration/services/transport-orders.integration.test.ts:204-207
await outerTx.execute(sql`
  SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: authUserId })}, true)
`);
```

- There is no separate production RLS-respecting Drizzle connection wrapper. The closest pattern is test-only transaction-local `SET LOCAL ROLE authenticated` / `set_config('request.jwt.claims', ...)`.

# Question 3: @supabase/ssr usage status

- Installed in manifest: `@supabase/ssr` at `package.json:38` (`^0.5.2`) and `@supabase/supabase-js` at `package.json:39` (`^2.49.4`).
- Lockfile resolved versions:
  - `@supabase/ssr` resolves to `0.5.2(@supabase/supabase-js@2.106.1)` at `pnpm-lock.yaml:32-34` and package block `pnpm-lock.yaml:2369`.
  - `@supabase/supabase-js` resolves to `2.106.1` at `pnpm-lock.yaml:2378` and dependency block `pnpm-lock.yaml:7203`.
- No existing SSR setup files: no `src/lib/supabase/server.ts`, `browser.ts`, or `src/middleware.ts`.
- `rg -n 'createServerClient|createBrowserClient|@supabase/ssr|@supabase/supabase-js' src tests` returned no matches.

# Question 4: Existing auth scaffolding

- `cookies()` from `next/headers`: no matches in `src` or `tests`.
- `createServerClient` / `createBrowserClient`: no matches.
- `middleware.ts`: no file.
- Auth routes/pages: only Cloudflare Turnstile API exists at `src/app/api/auth/turnstile/verify/route.ts:41-72`; no Supabase login/logout pages or server actions exist.

# Question 5: vendor_users auth_user_id seed status

- Schema has `vendor_users.auth_user_id`: Drizzle column at `src/lib/db/schema/vendor_users.ts:11-12`; raw DDL FK to `auth.users(id)` at `src/lib/db/raw-migrations/alpha-1-public/09_vendors.sql:36-38`.
- Master seed does not seed vendors or vendor users; it only seeds `lane_types` and `roles` (`src/lib/db/raw-migrations/alpha-1-public/21_seed_master.sql:12-30`).
- Tests that seed vendor users with auth context:
  - `tests/integration/tenant-isolation.test.ts:44-47` inserts `auth.users`, then `vendor_users.auth_user_id` at `tests/integration/tenant-isolation.test.ts:63-65`.
  - `tests/integration/services/transport-orders.integration.test.ts:160-175` creates a random `authUserId` and inserts it into `vendorUsers.authUserId`, but does not insert the matching `auth.users` row.
- Audit-log tests insert vendor users without `auth_user_id` (`tests/integration/record-audit-log.test.ts:163-165`, `425-427`, `450-452`) because those tests exercise audit triggers, not vendor auth.
- No onboarding flow found that creates Supabase `auth.users` rows (`rg 'signUp|admin.createUser|createUser|inviteUserByEmail' src tests` found no app flow).

# Question 6: AdminShell + (admin) route group pattern

- Route structure:
  - `src/app/layout.tsx:9-14` root layout only renders `<body>{children}</body>`.
  - `src/app/(admin)/layout.tsx:9-10` wraps children in `AdminShell`.
  - `src/app/(admin)/dashboard/page.tsx:9-30` and `src/app/(admin)/calendar/page.tsx:34-62` are current admin pages.
- No auth gate in admin layout/middleware. `src/app/(admin)/layout.tsx:9-10` is a plain wrapper; no `cookies()`, Supabase user lookup, redirect, or middleware.
- Admin paths resolve as route-group-hidden App Router paths: `src/app/(admin)/dashboard/page.tsx` -> `/dashboard`, `src/app/(admin)/calendar/page.tsx` -> `/calendar`.
- `AdminShell` navigation hardcodes `/dashboard`, `/calendar`, `/customers`, `/vendors`, `/settings` at `src/components/layout/admin-shell.tsx:8-14`; it displays a static `"管理者"` label at `src/components/layout/admin-shell.tsx:41-46`.

# Question 7: RPC respond_to_transport_order auth context expectation

- Yes, the RPC expects `auth.uid()` to be available through `current_vendor_user_id()`.
- `respond_to_transport_order` is `SECURITY DEFINER` (`src/lib/db/raw-migrations/alpha-1-public/24_vendor_rpcs.sql:24-26`) but still calls `public.current_vendor_user_id()` on reject at `24_vendor_rpcs.sql:112-117`; accept delegates to `accept_invitation_and_revoke_others()` at `24_vendor_rpcs.sql:55-60`.
- `current_vendor_user_id()` resolves `vendor_users.auth_user_id = auth.uid()` at `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:39-51`.
- Accept path helper also requires that auth context: `accept_invitation_and_revoke_others` calls `current_vendor_user_id()` and raises `42501` when missing at `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:182-187`.
- Service wrapper calls the RPC directly through Drizzle `db.execute(sql\`SELECT ... FROM public.respond_to_transport_order(...)\`)` at `src/lib/services/transport-orders.ts:244-260`.
- Existing integration tests propagate auth by calling `setAuthUid()` before `respondToTransportOrder()` (`tests/integration/services/transport-orders.integration.test.ts:204-207`, then examples at `317`, `369`, `415`, `462`, `483`, `534`, `563`, `580`).
- Production 16-D path differs: `@supabase/ssr` cookies/session refresh will authenticate Supabase clients, but current Drizzle `DATABASE_URL` queries will not automatically set `request.jwt.claims` or `SET LOCAL ROLE authenticated`. A server action that calls `respondToTransportOrder(db, ...)` unchanged will have `auth.uid()` null unless 16-D adds an explicit auth-context bridge or calls the RPC through a Supabase client carrying the user JWT.

# Critical findings (things that affect the 16-D plan)

- Current Phase 20 plan assumption “client / server action では `db.execute()` で RLS が自動適用” is false for the existing Drizzle direct Postgres path.
- Tests prove the needed DB-side mechanism: transaction-local `request.jwt.claims` (and, for RLS table policies, `SET LOCAL ROLE authenticated`).
- No Supabase SSR files or middleware exist yet despite packages being installed.
- `vendor_users.auth_user_id` is the true identity link; `vendor_users.id = auth.uid()` is obsolete for alpha-1 public helpers.
- No production vendor onboarding/auth user creation flow exists; test fixtures are not enough for login.
- Admin shell has no auth pattern to copy; vendor portal needs its own gate.

# Recommended additions to plan v1

- Add `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`, and `src/middleware.ts` using `@supabase/ssr` for cookie session refresh and `/vendor/*` redirects.
- Add a Drizzle auth-context helper, e.g. `withAuthenticatedDb(userId, fn)`, that opens one transaction, runs `SET LOCAL ROLE authenticated` plus `set_config('request.jwt.claims', '{"sub":"...","role":"authenticated"}', true)`, then executes all RLS/RPC work inside that transaction.
- Make vendor server actions get the user via Supabase SSR (`auth.getUser()`), then call `respondToTransportOrder()` only inside the authenticated Drizzle transaction helper.
- Add tests for production-like behavior: unauthenticated server action rejects; authenticated vendor user succeeds; different vendor gets `VendorAuthError`.
- Add or document a vendor onboarding/admin seed path that creates the Supabase auth user and stores `vendor_users.auth_user_id`.
