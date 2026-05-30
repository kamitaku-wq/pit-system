# Phase 64-A.33 設計プラン — Turnstile + IP/global 送信レート制限 (公開予約 surface の本番露出 hard 依存)

## 位置づけ

- 前提: A.32b sealed (email 6 桁コード本人確認ゲートを公開予約フローへ配線済み)。公開 surface (GET slots/menus + POST reservations/verification-code) は **A.33 完了まで本番露出禁止**。
- A.33 = 多層防御 (spec §12.3 / impl-plan §16 #9) を実装し、公開 surface を本番露出可能にする。
- A.32b baseline CI green 確認済み (run 26633014419, 4m18s success)。本ブランチは e2e.yml の push トリガーに一時追加済 (push ごとに CI 実行)。

## 設計判断 (advisor 確認済み)

### 1. rate-limit storage = pg-based (ユーザーに聞かず自決)

「Phase 0 で選定」と先送りされていた決定。pg-based を採用:

- 既存 (company,email) issue guard が既に DB カウント方式 / Redis 不在 / Vercel serverless (in-memory 不可) / MVP / **可逆**。
- Upstash 採用だけが外部依存・課金・provisioning を要するが MVP は不要。
- **可逆性担保**: `checkRateLimit(key, limit, windowSeconds)` という薄い interface を切り、pg 実装を裏に置く。将来 KV へ差し替える場合この 1 関数のみ再実装すれば route 側は無改修。

### 2. レイヤ順序 (A.32b oracle 不変条件を壊さない)

各 route で **rate limit を最前段**に置く (全リクエストをカウント → scanner も throttle、cheap-local DB write で outbound Cloudflare 呼出の前に load を shed)。

```
verification-code POST:
  1. rate limit (IP + global)        → 429 rate_limited
  2. companyId UUID 形式              → 404 company_not_found  (純形式、oracle なし)
  3. body parse (email + token)      → 400 invalid_body
  4. Turnstile verify(token, ip)     → 403 turnstile_failed
  5. requestReservationVerificationCode → 404 company_not_found / 200 (issue guard rate_limited は 200 据え置き ★)

reservations POST:
  1. rate limit (IP + global)        → 429
  2. companyId UUID                  → 404
  3. body parse                      → 400
  4. createVerifiedPublicReservation → 既存 reason 写像 (Turnstile なし: 既に code ゲート済)

GET slots / menus:
  1. rate limit (IP + global, 緩め)  → 429
  2. query / companyId 検証          → 400 / 404 (既存)
  3. service
```

**不変条件**:
- IP/global rate limit (429) と (company,email) issue guard (200 据え置き) は **別レイヤ・統合しない**。429 は service 呼出前に short-circuit するため issue guard の 200 と衝突しない。
- Turnstile/rate limit は company **存在 lookup** (service 内) より前 = 存在 oracle を漏らさない。companyId の **形式** 404 は純ローカル判定で oracle なし、Turnstile より前でよい。
- IP-rate を Turnstile より前に: cheap-local を outbound-Cloudflare より先に評価し、global rate で総 Cloudflare 呼出を上限化 (CAPTCHA を rate limit で保護する標準順)。両者とも company lookup 前。

### 3. Turnstile スコープ

- **verification-code POST のみ** Turnstile 検証 (email 送信 = Resend コストベクタ、人間チェックの最高価値地点)。
- **reservations POST は Turnstile 不要** (既に issue 時 Turnstile 通過済の code でゲート済、二重 challenge は UX 劣化、code brute-force は A.32a attempt 制限で有界)。IP rate のみ。
- **GET は Turnstile 厳禁** (idempotent/cacheable、毎クエリ challenge は破綻)。緩め throttle のみ。impl-plan §16 #9 も GET は "throttling" と明記。
- token は **single-use** (再利用で `timeout-or-duplicate`)。wizard の「再送」で widget を reset。
- `verifyTurnstileToken(token, remoteIp)` を service 化し既存 `api/auth/turnstile/verify/route.ts` から抽出共用。siteverify に **remoteip を渡す**。内部 HTTP ホップは避ける。

## 実装 (モジュール境界 = テスト可能性)

| モジュール | 役割 | テスト |
|---|---|---|
| `src/lib/db/raw-migrations/post/0026_rate_limit_counters.sql` | 汎用カウンタ DDL (真実の源) | — |
| `src/lib/db/schema/rate_limit_counters.ts` | drizzle schema (DDL と厳密一致、再生成しない) | — |
| `src/lib/rate-limit/rate-limiter.ts` | `checkRateLimit()` core (atomic upsert-increment、pg 実装) | service 層 DB integration |
| `src/lib/rate-limit/public-reservation-rate-limit.ts` | policy 定数 + `getClientIp` + `enforcePublicReservationRateLimit()` (route helper) | route が import → mock |
| `src/lib/services/turnstile.ts` | `verifyTurnstileToken(token, remoteIp)` (既存 route から抽出) | service 層 (poc-11 CF テストキー流用) |
| `src/app/api/auth/turnstile/verify/route.ts` | service を使うよう refactor (DRY) | 既存 poc-11 |
| 公開 route 4 本 | rate limit + (vcode のみ) turnstile を配線 | route 層 mock |
| `reservation-wizard.tsx` | step6 に Turnstile widget + token 同送 + 再送 reset | unit (wizard) |
| `turnstile-widget.tsx` | explicit render / callback で token を state へ + reset 公開 | unit |

### rate_limit_counters テーブル (固定窓カウンタ)

```sql
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket_key   text        NOT NULL,   -- 例 "rsv:vcode:ip:1.2.3.4" / "rsv:vcode:global"
  window_start timestamptz NOT NULL,   -- window 境界へ truncate
  count        integer     NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,   -- purge 用 (window_start + window*2)
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX ... ON rate_limit_counters (expires_at);  -- pg_cron purge 用
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;  -- policy 不在 = anon/authenticated 全拒否、service_role のみ書込 (0025 踏襲)
```

atomic increment (race-free):
```sql
INSERT INTO rate_limit_counters (bucket_key, window_start, count, expires_at)
VALUES ($key, $windowStart, 1, $expiresAt)
ON CONFLICT (bucket_key, window_start)
DO UPDATE SET count = rate_limit_counters.count + 1
RETURNING count;
```
→ `allowed = count <= limit`。window_start / expires_at は TS 側で `now` から算出 (now 注入でテスト可能)。

### policy 定数 (初期値、code 内で調整可)

| route | per-IP | global |
|---|---|---|
| vcode (verification-code) | 5 / 10min | 100 / 10min |
| create (reservations) | 10 / 10min | 200 / 10min |
| slots / menus (GET) | 60 / 1min | 600 / 1min |

(数値は MVP の防御的初期値。tunable。)

### env

- `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` は **既存** (vendor auth で使用、CI に CF テストキー設定済)。新規 env なし。
- rate limit は pg-based のため新規 env なし。
- 本番 Turnstile キー (実キー) の provisioning は seal 時の運用 action item (vendor auth と共通)。

## adversarial gate (Phase 64-A.26 #1) 該当

- **#1 raw-migration: 該当** (0026 新規) → 敵対的レビュー workflow を実施する。
- A.32b で非該当だった gate が A.33 で再該当。

## follow-up (本 phase 非ブロッカー)

1. rate_limit_counters の pg_cron purge job (expires_at index で準備済、0025 expired-code purge と同列)。未実装だと窓ごとに行が増える。
2. policy 定数のチューニング (本番トラフィック観測後)。
3. x-forwarded-for leftmost の信頼性: Vercel は edge で XFF を上書きするため leftmost = client IP。spoof しても global rate が backstop。

## 検証コマンド

`pnpm typecheck && pnpm test:unit && pnpm test:integration && pnpm build && pnpm prettier --check .`

*Phase 64-A.33 design-plan / Generated by Claude 2026-05-29*
