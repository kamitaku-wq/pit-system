# Phase 23 / Sprint β Recon: CI workflow に E2E 統合

## 1. 現 CI 状況

`.github/workflows/` は存在するが、`rg --files .github/workflows` はファイルなしを返したため、workflow YAML は未検出。既存 job は観測できず、`package.json` の `test:e2e: playwright test` は CI から未接続。`tests/e2e/vendor-portal-loop.spec.ts` には vendor portal loop の 2 case があり、Playwright 設定は存在するが、GitHub Actions 統合は未実装。

## 2. E2E 実行に必要な前提

- Node: `package.json` の `engines.node` は `>=20.11.0`、`packageManager` は `pnpm@9.15.0`。
- Playwright: `@playwright/test` は `^1.52.0`、`test:e2e` は `playwright test`。
- Browser: `playwright.config.ts` の project は `chromium` / `Desktop Chrome` のみ。
- Dev server: `playwright.config.ts` は既定で `pnpm dev` を `http://localhost:3000` へ起動し、`PLAYWRIGHT_SKIP_WEBSERVER` がある場合だけ無効化。
- Base URL: spec/config とも `PLAYWRIGHT_BASE_URL ?? http://localhost:3000`。
- CI 動作: `CI` で `forbidOnly=true`、retry 2、workers 2、reporter `github` + `list`。
- 必須 env: `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`DATABASE_URL` は E2E/spec/db client で直接参照。
- `.env.example` 由来 env: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`DIRECT_URL`、`NEXT_PUBLIC_APP_URL`、`RESEND_API_KEY`、`RESEND_FROM_EMAIL`、`INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`。
- `supabase/` は存在しないため、local Supabase CLI project の `config.toml` / migrations は観測なし。

## 3. Supabase 接続戦略の選択 (3 案比較)

| 案 | Pros | Cons | Cost | 推奨 |
|---|---|---|---|---|
| A. Supabase Branching | Preview 環境を CI ごとに分離できる (external source-backed) | repo に `supabase/` がなく migrations も未観測、導入作業が必要 | 有料 Pro+ プランのみ (task constraint; usage charge は Supabase docs) | 将来候補 |
| B. docker-compose local supabase | 無料で hermetic にできる (inferred) | `supabase/` 不在、`package.json` に Supabase CLI dep 不在、現状のままでは起動材料なし | 無料 | 現時点の MVP では非推奨 |
| C. dedicated staging project | `.env.example` の remote Supabase URL/pooler 前提に合い、CI は secrets 注入だけで始められる | staging DB/Auth の汚染防止と cleanup 監視が必要 | 無料枠内 or 有料 | MVP 推奨 |

## 4. GitHub Actions workflow 案 (推奨案の YAML skeleton)

```yaml
name: vendor-portal-e2e # package.json の test:e2e を CI に接続

on: # 既存 workflow は未検出なので最小 trigger から開始
  pull_request: # PR で vendor portal loop を検証
    branches: [main] # main 前提は skeleton の仮置き (inferred)
  workflow_dispatch: # 手動再実行用

jobs:
  vendor-portal-loop:
    runs-on: ubuntu-latest # Linux runner 前提、Windows local との差分は unresolved
    timeout-minutes: 20 # 初回 browser install を含む余裕枠 (inferred)
    env:
      CI: "true" # playwright.config.ts の CI 分岐を有効化
      PLAYWRIGHT_BASE_URL: http://127.0.0.1:3000 # spec/config の baseURL
      PLAYWRIGHT_SKIP_WEBSERVER: "1" # 手動 pnpm dev 起動と二重起動を避ける
      NEXT_PUBLIC_APP_URL: http://127.0.0.1:3000 # .env.example の App URL
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }} # spec が参照
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }} # .env.example 由来
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }} # .env.example 由来
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }} # seed helper が admin auth に使用
      DATABASE_URL: ${{ secrets.DATABASE_URL }} # src/lib/db/client.ts が必須
      DIRECT_URL: ${{ secrets.DIRECT_URL }} # migration/integration 用、E2E では任意

    steps:
      - name: Checkout # repo contents を取得
        uses: actions/checkout@v4

      - name: Setup pnpm # packageManager は pnpm@9.15.0
        uses: pnpm/action-setup@v4
        with:
          version: 9.15.0

      - name: Setup Node # engines.node は >=20.11.0
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm # pnpm store cache

      - name: Install dependencies # lockfile 使用は skeleton 仮定 (inferred)
        run: pnpm install --frozen-lockfile

      - name: Install Chromium # Playwright project は chromium のみ
        run: pnpm exec playwright install --with-deps chromium

      - name: Supabase strategy C env check # dedicated staging project を secrets で注入
        run: |
          test -n "$NEXT_PUBLIC_SUPABASE_URL"
          test -n "$SUPABASE_SERVICE_ROLE_KEY"
          test -n "$DATABASE_URL"

      - name: Supabase strategy B placeholder # local Supabase は現状 supabase/ 不在
        if: false
        run: supabase start # B 採用時のみ config.toml/migrations 追加後に有効化

      - name: Start Next.js dev server # playwright webServer の代わりに明示起動
        run: |
          pnpm dev > next-dev.log 2>&1 &
          echo $! > next-dev.pid

      - name: Wait for dev server # wait-on は package.json 未登録、導入方法は要決定
        run: pnpm dlx wait-on http://127.0.0.1:3000 --timeout 120000

      - name: Run E2E # package.json の test:e2e
        run: pnpm test:e2e

      - name: Upload Playwright report # html reporter 未設定なら空の可能性あり
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          if-no-files-found: ignore
          retention-days: 7

      - name: Upload traces/screenshots/logs # trace/screenshot と dev log を保存
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-debug-artifacts
          path: |
            test-results/
            next-dev.log
          if-no-files-found: ignore
          retention-days: 7
```

## 5. dev server 起動戦略

推奨 skeleton は `pnpm dev` を background 起動し、`PLAYWRIGHT_SKIP_WEBSERVER=1` で Playwright の内蔵 `webServer` を無効化する。port は config/spec と同じ 3000。health check は `wait-on http://127.0.0.1:3000` 案だが、`wait-on` は `package.json` に未登録なので `pnpm dlx wait-on` または curl loop の選択が必要 (inferred)。shutdown は job 終了で runner が process を破棄するが、必要なら `next-dev.pid` を使う cleanup step を追加する (inferred)。

## 6. DB seed strategy

`tests/e2e/vendor-portal-loop.spec.ts` は `beforeAll` で `seedVendorE2ELoop(db, supabaseAdmin)`、`afterAll` で `cleanupVendorE2ELoop` を呼ぶため、CI に別 pre-seed step は不要。seed helper は `crypto.randomUUID()` で company/order/vendor/auth user を作り、失敗時は auth user を削除し、DB transaction を rollback する。通常終了時は invitation/order/ticket/vehicle/store/vendor_user/vendor/status/company と auth user を削除する。idempotent というより「UUID 隔離 + 明示 cleanup」方式で、runner 強制終了時の残骸は unresolved。

## 7. Artifact upload

`playwright.config.ts` は `trace: on-first-retry`、`screenshot: only-on-failure`、video は未設定。upload 対象は `test-results/`、`next-dev.log`、HTML reporter を有効化する場合は `playwright-report/`。retention は 7 days を初期値にする (inferred)。

## 8. 必要な secrets / GitHub Actions config

- 必須: `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`DATABASE_URL`。
- App 起動用候補: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`NEXT_PUBLIC_APP_URL`。
- migration/integration 併用時候補: `DIRECT_URL`。
- E2E route が触る場合のみ候補: `RESEND_API_KEY`、`RESEND_FROM_EMAIL`、`INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`。
- plain `SUPABASE_URL` / `SUPABASE_ANON_KEY` は観測なし。観測名は `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY`。

## 9. cost / 実行時間見積もり

1 run は dependency cache hit 前提で 4-8 min、cold browser install 込みで 8-12 min 程度 (inferred)。PR 100 runs/month なら約400-1,200 Linux minutes/month (inferred)。GitHub docs では private repo の GitHub Free quota は 2,000 minutes/month、public repo の standard GitHub-hosted runner は free。Strategy C は Supabase staging project の既存 usage に依存、A は Branching usage charge が別途発生する。Sources: https://docs.github.com/en/billing/concepts/product-billing/github-actions , https://supabase.com/docs/guides/platform/manage-your-usage/branching

## 10. 段階分割案

MVP は Strategy C: staging Supabase secrets を GitHub Actions に入れ、`pnpm install`、Chromium install、`pnpm dev`、wait、`pnpm test:e2e`、artifact upload だけを追加する。次に B を検討する場合は `supabase/`、`config.toml`、migrations/seed、Supabase CLI 導入を別 Phase に分離する。A は Pro+ / branching cost を許容し、migration source が repo に整った後の optional migration。

## 11. 既知の懸念・unresolved

- `.github/workflows/` に YAML がなく、既存 CI style / permissions / branch policy は未観測。
- `supabase/` 不在、migrations count は 0 扱いではなく「未観測」。local Supabase 起動は現状不可。
- `package.json` に `supabase` / `supabase-cli` / `wait-on` dependency は未観測。
- CI skeleton は Linux shell 前提だが、現在の作業環境は Windows/PowerShell。background process と path の差分に注意。
- Playwright CI reporter は `github` + `list` のみなので、`playwright-report/` upload には html reporter 追加が必要 (inferred)。
- service role key は Auth admin create/delete に使うため、production project の secrets を CI に入れない運用が必要 (inferred)。
- cleanup は `afterAll` 前提のため、job cancel / runner kill では staging に fixture が残る可能性がある (inferred)。
