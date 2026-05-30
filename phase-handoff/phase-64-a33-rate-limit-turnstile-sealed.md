# Phase 64-A.33 Turnstile + IP/global 送信レート制限 (公開予約 surface 多層防御) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.33 (前: A.32b email 6 桁コード本人確認ゲート) |
| 状態 | **sealed** (typecheck clean / unit 79 PASS / integration 501 PASS / next build 0err0warn / prettier 変更ファイル clean) |
| 担当 | Claude (advisor 2 + 敵対的レビュー: Codex 独立 1 + workflow 20 agent。HIGH 1 + should_fix 5 を反映。block override 9 件 = auth/DoS/security 判断密度高による自実装) |
| Branch | `phase-64-mvp-implementation` |
| **migration** | **0026 rate_limit_counters** (新規) → adversarial gate #1 (raw-migration) **該当** |
| **CI** | A.32b baseline green 確認済 (run 26633014419)。e2e.yml の push トリガーに本ブランチを一時追加済 (main マージ時に削除)。A.33 push 後の CI 結果は本 seal 後に確認 |
| **/clear 推奨** | **推奨** (次 A.34 または公開 surface 露出作業。本番露出には下記 prerequisite が hard 依存) |

## スコープ

A.32b で配線した公開予約 surface (GET /r/reserve/[companyId]/slots,/menus; POST /reservations,/verification-code) を本番露出可能にする多層防御 (spec §12.3 / impl-plan §16 #9)。Cloudflare Turnstile + IP/global 固定窓レート制限を全 route 前段に配線。

## 実装 (新規 5 + 既存改修 6 + テスト 3)

- **migration** `0026_rate_limit_counters.sql`: 汎用固定窓カウンタ `rate_limit_counters(bucket_key, window_start, count, expires_at, created_at, PK(bucket_key,window_start))`。RLS ENABLE + policy 不在 = anon/authenticated 全拒否・service_role のみ書込 (0025 canonical 踏襲)。bucket_key 長さ CHECK(<=500)。expires_at index (purge 用)。
- **`rate-limiter.ts`** (`checkRateLimit`): 薄い interface。atomic upsert-increment (`INSERT ... ON CONFLICT DO UPDATE SET count = count+1 RETURNING count`) で race-free。固定窓 (window 境界 truncate)。now 注入可能。**storage 選定の de-risk**: 将来 Upstash/KV へはこの 1 関数のみ差し替えで route 無改修。
- **`public-reservation-rate-limit.ts`**: policy 定数 + `getClientIp` + `enforcePerIpRateLimit` / `enforceGlobalRateLimit`。
- **`turnstile.ts`** (`verifyTurnstileToken`): 既存 `api/auth/turnstile/verify` から抽出共用。remoteip 渡し、fail-closed、single-use。既存 route は本 service 利用へ refactor (consumer なしでゼロリスク)。
- **公開 route 4 本**: 各前段に rate limit を配線。`reservation-wizard.tsx` step6/7 に Turnstile widget (single-use, key remount で再送 reset) + token 同送。`turnstile-widget.tsx` を explicit-render + onVerify callback へ刷新。

## レイヤ順序 (最重要不変条件 — A.32b oracle + 敵対的レビュー HIGH 対応)

```
verification-code POST:
  1. per-IP rate limit          → 429 (最前段、cross-company で IP 総量を縛り flood を shed)
  2. companyId UUID 形式        → 404 (純形式、oracle なし)
  3. body parse (email+token)   → 400
  4. Turnstile verify(token,ip) → 403
  5. global rate limit (company単位) → 429  ★Turnstile 成功後
  6. requestReservationVerificationCode → 404 company_not_found / 200 (issue guard rate_limited は 200 据え置き)

reservations POST / slots GET / menus GET:
  1. per-IP rate limit → 429
  2. companyId UUID    → 404
  3. global rate limit (company単位) → 429   (Turnstile なし)
  4. body/query parse  → 400
  5. service
```

| 不変条件 | 実装 |
|---|---|
| **global を Turnstile 後に評価** | Turnstile を解かない garbage で company の global を枯渇させ全ユーザーをロックアウトする「防御の自爆」を塞ぐ (HIGH fix) |
| **global は company 単位** (`rsv:<route>:global:<companyId>`) | 1 社のトラフィックが他社を 429 にする **cross-tenant blast radius を排除** (HIGH fix) |
| per-IP は cross-company (`rsv:<route>:ip:<ip>`) | 単一 IP の総量を縛る。最前段で安価に flood を shed |
| A.32b oracle 保持 | 429/403 は company存在/email/issue-state を漏らさない。issue guard rate_limited は 200 据え置き (IP/global 429 とは別レイヤ)。Turnstile/rate は company 存在 lookup より前 |
| Turnstile スコープ | verification-code のみ (email=Resend コストベクタ)。reservations/GET は IP/global rate のみ (code ゲート済 / GET は idempotent) |

## 敵対的レビュー (gate #1 該当 → Codex 独立 + workflow 並走)

両者が中心脆弱性で収束 → **GO_WITH_FIXES**。

**反映済み [HIGH must_fix]**: *XFF 左端 spoof で per-IP 回避 → Turnstile 前の cross-tenant 共有 global を枯渇 → platform-wide DoS (全社 10 分ロックアウト)*。3 修正を併用で反映:
1. **global を Turnstile 成功後へ移動** (vcode)。garbage では global を消費できない。
2. **global を company 単位 scope**。cross-tenant blast radius 排除。
3. **getClientIp を x-real-ip 優先 + 45 字 cap** (best-effort、非 spoofable 源)。

**反映済み [should_fix]**: slots route の companyId 検証を query parse 前へ (menus と順序統一) / bucket_key 長さ CHECK + getClientIp cap (長大 forged ヘッダで btree PK 超過→500 を防ぐ) / route テストの per-IP・global 順序検証強化。

**回帰テスト (HIGH fix 検証)**: `verification-code-turnstile-global-ordering.integration.test.ts` — 実 rate-limiter + 実 DB で **Turnstile 失敗時に global が increment されない** ことをカウンタ検査で実証 (route 層 mock では検出不能な並び替えを固定)。

## 本番露出 prerequisite (hard 依存 — silently 仮定しない)

公開 surface の本番露出は以下が **未解決のため依然 hard 依存**。閉じたのは cross-tenant platform-wide DoS のみ。

1. **non-Turnstile route (特に create) の per-company 可用性 DoS は IP 源の信頼性に依存**。create/slots/menus は Turnstile を持たないため、per-company global を守るのは getClientIp が返す IP の非 spoofability のみ。本番 deployment の IP 信頼境界 (Vercel の x-real-ip / `@vercel/functions` `ipAddress()` の非偽装性) を **本番露出前に検証**すること。検証できない/偽装可能なら create に Turnstile を足すか trusted-IP middleware を導入する。残リスク: 偽装 IP 前提で 1 社の予約/枠検索を窓単位 (create 10min) で抑止可能 (データ毀損なし、slots/menus は 1 分窓で自己回復)。
2. **`rate_limit_counters` の purge job**。global per-company key + per-IP key は cardinality が無制限に増えるため、purge 無しだとテーブルが無限増殖 (storage/perf DoS)。expires_at index は準備済。`DELETE FROM rate_limit_counters WHERE expires_at < now()` を pg_cron 等で定期実行する設定を **本番露出前に整備**する。
3. **本番 Turnstile 実キー** (`TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) の provisioning (CI は CF テストキー)。vendor auth と共通。

## invariants (A.34 / 後続で壊さない)

- typecheck clean / unit 79 PASS / **integration 501 PASS** / next build 0err0warn / prettier clean。
- **global は Turnstile 後 + company 単位** (vcode)。`rsv:<route>:global:<companyId>`。Turnstile 失敗時に global を increment しない。
- **per-IP は cross-company** `rsv:<route>:ip:<ip>`、最前段。
- **A.32b oracle**: verification-code は issue 結果を汎用 200 (company_not_found のみ 404)。verification_failed 1 種 (422)。429/403 は oracle を漏らさない。
- **checkRateLimit の atomicity** (ON CONFLICT DO UPDATE RETURNING) を維持。判定は increment 後の count <= limit。
- Turnstile は verification-code のみ。reservations/GET には付けない。
- getClientIp は x-real-ip 優先 + 45 字 cap。

## follow-up (非ブロッカー)

1. 総 Resend コスト上限が要れば、Turnstile 後に高閾値の deployment-wide global cap を追加 (現状 per-company のみ)。
2. policy 定数 (PUBLIC_RATE_LIMITS) の本番トラフィック観測後チューニング。
3. 固定窓の境界バースト (2窓で 2×limit) — MVP では許容。厳密化が要れば sliding window (checkRateLimit のみ差し替え)。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 2 (実装 + レビュー反映) ※本 seal で reviews 反映分を commit |
| 変更ファイル | 新規 5 (migration/schema/rate-limiter/policy/turnstile) + 既存改修 6 (route 4 + wizard + widget + 既存 turnstile route) + テスト 3 |
| 新規/更新 tests | unit +7 (turnstile) / integration: rate-limiter (atomic/window/concurrency/per-IP/per-company global) + route 層防御 + 回帰テスト (Turnstile後global) |
| advisor | 2 (着手前: 設計 + storage 自決 / レビュー後: HIGH fix 再設計の second-order チェック) |
| 敵対的レビュー | Codex 独立 (GO_WITH_FIXES) + workflow 20 agent / 12 confirmed (HIGH 1 反映 + should_fix 5 反映) |
| Codex 委任 | 0 (auth/DoS/security 判断密度高で自実装、block override 9 件 = 例外記録) |
| MVP blocker | 公開予約 surface の多層防御 (Turnstile + rate limit) 配線完了。本番露出は上記 prerequisite 3 件が残 |

## A.34 引き継ぎ契約

1. 公開 surface 本番露出には本 seal の prerequisite 3 件 (IP 信頼境界検証 / purge job / 本番 Turnstile キー) が hard 依存。
2. rate limit policy・Turnstile スコープ・oracle 不変条件・global の Turnstile後/company単位 を壊さない。
3. e2e.yml の push トリガーから `phase-64-mvp-implementation` を削除するのは main マージ時。

*Phase 64-A.33 sealed / Generated by Claude 2026-05-29 / 次: A.34 または公開 surface 露出 (要 prerequisite 解決 + /clear)*
