# Phase 64-A.32b email 6 桁コード本人確認ゲート配線 (verify gate + 送信 + wizard) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.32b (前: A.32a email 6 桁コード security core) |
| 状態 | **sealed** (typecheck clean / unit 72 PASS / integration 481 PASS (+4) / next build green 0err0warn / prettier clean) |
| 担当 | Claude (advisor 1 + 敵対的レビュー workflow 22 agent / 12 確定指摘 → must_fix(HIGH) 1 + MEDIUM 1 + LOW 1 を反映、残 should_fix 記載。block override 6 件 = auth/crypto/UI 判断密度高による自実装) |
| Branch | `phase-64-mvp-implementation` |
| **migration** | **なし** (A.32a の 0025 を再利用。outbox は既存 `notification_outbox` の null entity FK で対応 = adversarial gate #1 非該当) |
| **/clear 推奨** | **推奨** (次 A.33 = Turnstile + IP/global 送信レート制限。本番露出の hard 依存を解く独立 phase) |

## スコープ (A.32a 引き継ぎ契約の完遂)

A.32a (security core: issue/verify + migration 0025) の上に「email 送信 (outbox) + verify gate の予約フローへの差し込み + wizard step6/7 UI」を配線。create-on-confirm (A.29) のため予約はコード検証**後**に作られる。

## 実装 (変更ファイル: 新規 3 + 既存 8 + CI/spec/env)

- **新規 orchestration** `src/lib/services/customer-reservation-verification.ts`:
  - `renderReservationVerificationEmail` — 件名にコードを載せない pure テンプレート (html/text)。
  - `requestReservationVerificationCode` — **company gate → issue → outbox INSERT を単一 tx**。生コードを email に載せ、`company_not_found`/`rate_limited` を返す。
  - `createVerifiedPublicReservation` — **verify(消費) → createPublicReservation を単一 tx で原子化 (Design A)**。create 失敗時は `VerifiedReservationRollback` を throw して tx ごと rollback しコードを温存。verify 失敗は通常リターンで commit (attempt++ 永続)。
- **新規 route** `src/app/r/reserve/[companyId]/verification-code/route.ts` (POST issue) — ok/rate_limited は汎用 200、`company_not_found` のみ 404。
- **既存改修**:
  - `reservations/route.ts` — `publicCustomerSchema` (email 必須) + `code` + `createVerifiedPublicReservation` 委譲 + `verification_failed→422`。
  - `reservation-payload.ts` — `ReservationPayload.code` + `buildReservationPayload(code)` + `reasonToMessage(verification_failed)`。
  - `reservation-wizard.tsx` — STEP_LABELS 7 段、step4 email 必須 (HTML5 native)、step5「次へ」、step6 メール認証 (sendCode)、step7 コード入力 (submit with code)、step8 完了。
  - `customer-reservation-public.ts` — `isPublicCompanyActive` を export (issue の company gate 再利用)。
  - `reservation-verification-codes.ts` (A.32a) — `verifyVerificationCode` の `verifiedEmail` を **`row.email` (DB 永続値)** で返すよう変更 (drift 防止、behavior-equivalent)。
- **テスト**: unit (`reservation-payload.test.ts` +code/verification_failed、`customer-reserve-wizard.test.tsx` 新フロー全書換)、integration (`customer-reservation-verification.integration.test.ts` 新規 10 ケース、`customer-reservation-public-routes.integration.test.ts` verify gate + issue route)。
- **CI** `.github/workflows/e2e.yml` — **`pnpm test:integration` ステップ + `RESERVATION_VERIFICATION_CODE_PEPPER` を追加** (HIGH 修正、後述)。
- **spec** `data-model.md` §3.8/§12 を A.32b done に更新。**`.env.example`** に `RESERVATION_VERIFICATION_CODE_PEPPER=` (A.32a 積み残し、本 phase で確認)。

## Design A (最重要不変条件): verify 消費と予約作成は不可分

| 防御 | 実装 |
|---|---|
| slot_unavailable race でコードを焼かない | verify(消費)+create を単一 tx。create 失敗 → throw → outer tx rollback で消費取消。`createCustomerReservation` の 23P01 は内側 savepoint の外で捕捉され outer tx 生存 (create.integration.test 二重予約テストが outerTx 経由で実証) → その結果を見て本 module が throw |
| email binding | verify が返す `verifiedEmail` (= `row.email`) で予約 customer.email を**必ず上書き**。クライアント送信 email は verify の lookup key にのみ使う。別 email/別 company は not_found |
| oracle 緩和 | not_found/invalid_code/expired/locked を `verification_failed` (→422) 1 種へ畳む。`remainingAttempts` を結果/レスポンスに出さない |
| issue+outbox 原子性 | issue commit 済なのに outbox 未挿入 = コードあるが email 飛ばずを防ぐため単一 tx |
| company 存在 oracle 回避 | issue は company gate で不在 company を 404 正規化し、FK 23503→500 の「200=実在/500=不在」oracle を封じる |

## adversarial gate (Phase 64-A.26 #1) 該当判定

| # | 条件 | 該当 |
|---|---|---|
| 1 | raw-migration | **非該当** (migration なし、A.32a 0025 再利用) |
| 2 | 新規署名鍵/session | 非該当 (A.32a HMAC pepper 再利用) |
| 3 | 手書き RLS/Storage policy | 非該当 |
| 5 | 新規 cross-tenant boundary | **境界線** → 念のため敵対的レビュー workflow を実施 (下記) |

## 敵対的レビュー workflow 結果 (22 agent / 5 観点 → 各指摘を敵対的検証 → 統合)

**判定: GO_WITH_FIXES**。**live exploit ゼロ**。Design A 原子性・email binding・oracle 緩和はコードレベルで成立 (savepoint 意味論を drizzle-orm 実装まで確認)。

**反映済み**:
- **[HIGH must_fix] CI が統合テストを実行していなかった** (`e2e.yml` は playwright のみ、`pnpm test:integration` 未呼出) → Design A 不変条件の regression が CI 素通り。**`e2e.yml` に integration ステップ + pepper env を追加**して修正 (db:setup 済 local Supabase に対して実行)。
- **[MEDIUM] issue route が不在 company UUID で 500** (FK 23503 未捕捉、存在 oracle + "常に 200" 不変条件違反) → company gate で `company_not_found`(404) に正規化。
- **[LOW] `verifiedEmail` が client 由来 normalize 値** → `row.email` 返却に変更 (drift 防止)。
- **[LOW] expired/locked oracle 未テスト** → integration テスト 2 件追加。

## 残 should_fix (本 phase 非ブロッカー、follow-up)

1. **[MEDIUM] issue+outbox 原子性の失敗注入テスト欠如** — production は単一 tx で正。outbox INSERT 失敗→code rollback を実証するテストが無い (clean な注入手段が無く defer)。
2. **[LOW] Design A 原子性テストの事前 INSERT が NOT NULL hardening に脆弱** — `reservations` の status_id 等が将来 NOT NULL 化すると pre-insert が落ちる (loud fail なのでサイレント誤検知ではない)。seed helper 化で解消可。
3. **[LOW] email-binding テスト命名が過大** — `verifiedEmail` 上書きの実証は happy-path テスト側 (`customerRow.email` 正規化 assert)。命名/コメントの精度問題のみ。
4. **[LOW] DB-write timing 差** (not_found=0write vs invalid_code=1write) — body/status oracle は閉鎖済。実用上ほぼ無害、A.33 (rate 制限) scope。

## invariants (A.33 / 後続で壊さない)

- typecheck clean / unit 72 PASS / **integration 481 PASS (+4: company_not_found / expired / locked / route company_not_found)** / next build green / prettier clean。
- **email binding (最重要)**: 予約 customer.email は verify の `verifiedEmail`(=DB row.email) で上書き。クライアント email 不信用。
- **Design A 原子性**: verify(消費)+create は単一 tx。create 失敗時はコード温存。`VerifiedReservationRollback` sentinel + outer-catch を消さない。
- **oracle**: not_found/invalid_code/expired/locked → verification_failed 1 種。remainingAttempts 非開示。
- **issue route の汎用 200**: ok/rate_limited は区別しない。company_not_found のみ 404。
- **outbox 形状**: entity FK 全 null / `target_type='customer'` (DB CHECK) / `target_id`=コード id / `idempotency_key='rvc:'+id` / payload pre-rendered。dispatcher は payload.{to,subject,html,text} を直読み。
- **本番露出は A.33 完了が hard 依存** (Turnstile + IP/global 送信レート制限。再発行で attempt がリセットされる + 6 桁低エントロピーのため)。

## 運用 action item

1. **env**: `RESERVATION_VERIFICATION_CODE_PEPPER` (>=16 文字) を .env.local / staging / 本番 / CI に設定済みであること (CI は e2e.yml に追加済、本番は要確認)。未設定で issue/verify が fail-fast。
2. **CI**: `e2e.yml` に integration ステップを追加済。今後 integration テストは CI で走る (local Supabase 必須)。

## A.33 引き継ぎ契約

1. 公開 surface (GET slots/menus + POST reservations/verification-code) の本番露出は A.33 完了が hard 依存。
2. Turnstile (β-3 束ね、spec §12.3) + IP/global 送信レート制限を verification-code / reservations route の前段に差す。issue の (company,email) rate guard は暫定。
3. expired code の TTL purge job (pg_cron) は 0025 の `expires_at` index で準備済。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 2 (backend / wizard) |
| 変更ファイル | 新規 3 + 既存改修 8 + CI/spec/env 3 |
| 新規 integration tests | 10 (issue+outbox / rate / company_not_found / happy / **Design A 原子性** / email binding / wrong / expired / locked / render) |
| advisor | 1 (着手前: Design A 成立判定) |
| 敵対的レビュー | workflow 22 agent / 12 確定指摘 (HIGH 1 + MEDIUM 1 反映 / LOW 1 反映 / 残 should_fix 4) |
| Codex 委任 | 0 (auth/crypto/UI 判断密度高で Claude 自実装、block override 6 件 = 例外記録) |
| MVP blocker | 顧客予約フローの本人確認ゲートが配線完了 (本番露出のみ A.33 残) |

*Phase 64-A.32b sealed / Generated by Claude 2026-05-29 / 次: A.33 (要 /clear。Turnstile + IP/global 送信レート制限 = 公開 surface 本番露出の hard 依存)*
