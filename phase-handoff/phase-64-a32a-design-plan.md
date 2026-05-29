# Phase 64-A.32a 設計 plan — email 6 桁コード本人確認 (security core)

> 状態: **design v2 (敵対的レビュー反映済み)**。TDD 実装直前。seal で本ファイルを handoff 化。
> Branch: `phase-64-mvp-implementation`
> レビュー: workflow `a32a-design-adversarial-review` (reviewer 4 = security/atomicity/spec-migration/Codex + synthesize)。
> 判定 CONDITIONAL GO → HIGH 4 / MEDIUM 2 / LOW 4 を全て反映して GO。

## スコープ確定 (ユーザー判断: 2 分割)

- **A.32a (本 phase) = security core**: migration 0025 + 新テーブル + issue/verify-code service。**email 送信に非依存**で完全に unit/integration テスト可能。
- **A.32b (次 phase)** = email 送信配線 (outbox) + route gate (`createPublicReservation` 前に verify 差し込み) + wizard step6/7 UI。

## なぜ token 機構を再利用せず新テーブルか (sealed 決定の帰結)

| 制約 | 出典 | 帰結 |
|---|---|---|
| 予約はコード検証**後**に作成 (create-on-confirm) | A.29 sealed (ユーザー判断) | 検証時点で reservation 行が存在しない |
| `customer_reservation_tokens.reservation_id` NOT NULL FK | schema / 11_reservations.sql | コードをここに入れられない |
| 検証状態は 2 req 跨ぎ + 再試行 + serverless 複数インスタンス共有 | アーキ | Postgres のみ適格 |

## 脅威モデルと防御 (6 桁 = ~20bit は token=256bit と本質的に異なる)

| 防御 | A.32a | 値・実装 |
|---|---|---|
| **partial unique index** (active 1 行/email) | ✅ | `(company_id,email) WHERE consumed_at IS NULL` UNIQUE。直列化・決定論の土台 (review HIGH#1) |
| **HMAC ペッパー** (DB 読取漏洩耐性 + email binding 暗号強制) | ✅ | `HMAC-SHA256(pepper, companyId:email:code)`、pepper は env のみ (review HIGH#2) |
| verifiedEmail 返却 (binding を型で強制) | ✅ | 成功型に `verifiedEmail` (review HIGH#3) |
| 発行レート guard (再発行ブルートフォース緩和) | ✅ | 同一(company,email)の直近 `ISSUE_RATE_WINDOW_MIN` に `ISSUE_RATE_MAX` 回まで (review HIGH#4-A) |
| 試行回数制限 + ロック | ✅ | `max_attempts=5`、超過で verify 不可 |
| 短 TTL | ✅ | `ttlMinutes=10` |
| single-use | ✅ | `consumed_at` |
| supersede (再発行で旧無効化) | ✅ | 発行 tx 内で旧 active を consume + unique index で強制 |
| timing-safe 比較 | ✅ | `crypto.timingSafeEqual` |
| **送信レート制限 (IP/global) + Turnstile** | ❌ A.33 | spec §12.3 L1/L3。**A.32b の本番露出は A.33 完了が hard 依存** (review HIGH#4-B) |
| 期限切れ行 purge | ❌ A.33 | pg_cron。`expires_at` index は先行定義 (review LOW#10) |

### email binding (最重要 invariant)
コードは特定 email 宛発行。`verifyVerificationCode` は (company_id, email) で active 行を引き、HMAC にも email を畳み込む。
- 攻撃: email A でコード取得 → 他人(email B)の予約を A コードで確定。
- 構造封じ: (1) lookup が email でスコープ → B では not_found。(2) HMAC に email 折込 → 仮に行が来ても hash 不一致。(3) verify が `verifiedEmail` を返し、**A.32b は customer.email をクライアント送信値ではなく verifiedEmail から取得する契約** (型 + doc で固定)。
- A.32b テスト #10 (verify email == 予約 customer.email) を本 plan にスタブ記載 (runtime 強制は A.32b で完結)。

## migration 0025 (DDL = 真実の源、raw-migrations/post)

`src/lib/db/raw-migrations/post/0025_reservation_verification_codes.sql`

```sql
-- Phase 64-A.32a: 顧客公開予約フローの email 6 桁コード本人確認 (security core)
-- spec/requirements.md §12.1 step6-7 / §12.3 / spec/data-model.md §3.x (新規)
CREATE TABLE IF NOT EXISTS public.reservation_verification_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email         text NOT NULL,
  code_hash     text NOT NULL,           -- HMAC-SHA256(pepper, companyId:email:code) hex。生コード非保存
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,             -- 検証成功 or supersede で now()
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_verification_codes_attempt_count_nonneg CHECK (attempt_count >= 0),
  CONSTRAINT reservation_verification_codes_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT reservation_verification_codes_email_normalized CHECK (email = lower(email))
);
-- active コードは (company_id, email) 毎に最大 1 件 (concurrent issue 直列化 / 決定論)。
CREATE UNIQUE INDEX IF NOT EXISTS reservation_verification_codes_active_per_email_uniq
  ON public.reservation_verification_codes (company_id, email)
  WHERE consumed_at IS NULL;
-- A.33 purge job 用 (TTL cleanup を pg_cron で実装予定)。
CREATE INDEX IF NOT EXISTS reservation_verification_codes_expires_at_idx
  ON public.reservation_verification_codes (expires_at);
```

- onDelete **CASCADE**: ephemeral・非業務データで company ライフサイクルをブロックすべきでない (token の restrict と意図的に異なる)。レビュー非指摘。
- ip_address/user_agent 列は**持たない** (canonical 踏襲、dead column 回避)。ip/ua は verify 成功時 audit_logs にのみ記録 (review MEDIUM#7-A)。
- `updated_at` はトリガーを置かず、service の全 UPDATE で明示 `updatedAt: new Date()` (canonical 踏襲、review LOW#8-B)。
- drizzle mirror: `src/lib/db/schema/reservation_verification_codes.ts` (列名/型/nullable/partial unique index を DDL と厳密一致)。
- `schema/index.ts` に alphabetical 挿入 (reservation_status_history と reservations の間)。

## pure helpers: `src/lib/services/reservation-verification-code-crypto.ts` (db 非 import)

- 定数: `RESERVATION_VERIFICATION_CODE_LENGTH=6` / `DEFAULT_TTL_MINUTES=10` / `DEFAULT_MAX_ATTEMPTS=5` / `ISSUE_RATE_WINDOW_MINUTES=10` / `ISSUE_RATE_MAX=5` / `PEPPER_MIN_LENGTH=16`
- `generateNumericCode(len)`: `crypto.randomInt(0, 10**len)` を `padStart(len,"0")` (unbiased CSPRNG)
- `normalizeEmail(email)`: `trim().toLowerCase()`
- `hashCode({ companyId, email, code, pepper })`: `HMAC-SHA256(pepper, ` + `${companyId}:${normalizeEmail(email)}:${code})` hex。companyId=UUID 固定長 + code=6桁固定長で連結が一意 (collision なし)。
- `timingSafeEqualHex(a,b)`: 長さ不一致を先に false、その後 `crypto.timingSafeEqual`
- `resolvePepper(override?)`: `override ?? process.env.RESERVATION_VERIFICATION_CODE_PEPPER`、未設定/`< PEPPER_MIN_LENGTH` で throw (fail-fast)。**lazy** (module load 時には読まない → import が env を要求しない)。

## service: `src/lib/services/reservation-verification-codes.ts` (service-role, company 引数)

公開フローは匿名。`customer-reservation-public.ts` 同様 service-role + companyId 引数、`options.db` で test 注入。
**契約 (review MEDIUM#6)**: 各関数の全 DB 操作は内部の単一 `db.transaction(async (tx) => {...})` 内で実行。`options.db` は `.transaction()` をサポートするクライアント (serviceRoleDb / test outerTx)。

### `issueVerificationCode(input, options) → IssueResult`
- input: `{ companyId(uuid), email, ttlMinutes?(1..60), maxAttempts?(1..10) }` (Zod strict)。`options: { db?, pepper? }`
- email を normalize。tx (23505 で最大 3 回 retry):
  1. **rate guard**: `COUNT(*) WHERE company_id, email, created_at > now() - ISSUE_RATE_WINDOW_MINUTES`。`>= ISSUE_RATE_MAX` → `{ ok:false, reason:"rate_limited" }`
  2. **supersede**: `UPDATE consumed_at=now(), updated_at=now() WHERE company_id, email, consumed_at IS NULL`
  3. code 生成 + `hashCode`、`expiresAt = now + ttl`
  4. INSERT (attempt_count=0)。23505 (active unique 競合) → retry
  5. `{ ok:true, id, code, expiresAt }` (生 code は 1 度だけ返す → A.32b が email へ)

```ts
type IssueResult =
  | { ok: true; id: string; code: string; expiresAt: Date }
  | { ok: false; reason: "rate_limited" };
```

### `verifyVerificationCode(input, options) → VerifyResult`
- input: `{ companyId(uuid), email, code }`。`options: { db?, pepper?, ipAddress?, userAgent? }`
- email を normalize。tx:
  1. active 行 `WHERE company_id, email, consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE` (unique index で最大 1 件だが防御的に LIMIT)
  2. none → `not_found`
  3. `expires_at <= now()` → `expired`
  4. `attempt_count >= max_attempts` → `locked`
  5. `timingSafeEqualHex(hashCode(...), row.code_hash)`:
     - match → `UPDATE consumed_at=now(), updated_at=now() WHERE id` → audit_logs INSERT (entityType="reservation_verification_code", entityId=id, action="update", actorKind="system", afterJson{kind:"customer_email_verify"}, ip/ua from options) → `{ ok:true, reason:"ok", codeId:id, verifiedEmail }`
     - mismatch → `UPDATE attempt_count=attempt_count+1, updated_at=now() WHERE id RETURNING attempt_count` → 新 attempt_count `>= max` なら `locked` 否なら `{ ok:false, reason:"invalid_code", remainingAttempts: max-attempt_count }`

```ts
type VerifyResult =
  | { ok: true; reason: "ok"; codeId: string; verifiedEmail: string }
  | { ok: false; reason: "not_found" | "expired" | "locked" }
  | { ok: false; reason: "invalid_code"; remainingAttempts: number };
```

## テスト

- **unit** `tests/unit/reservation-verification-code-crypto.test.ts`: gen 桁/範囲 (1000 サンプル `/^\d{6}$/`、"000000" 下限可)、HMAC 決定性 + 同一入力一致 + 入力差で不一致 + hex64、normalizeEmail、timingSafeEqualHex (一致/不一致/長さ違い)、resolvePepper (未設定/短い→throw, override 採用)、hashCode が email/companyId で異なる (binding)。
- **integration** `tests/integration/services/reservation-verification-codes.integration.test.ts` (withRollback + test pepper を options で注入):
  1. issue→verify happy (ok, verifiedEmail 正規化, consumed)
  2. wrong → invalid_code + remainingAttempts 減、attempt_count++ 永続
  3. max 到達で locked (正コードでも locked)
  4. expired (ttl=過去 注入 or 直接 expires_at backdate)
  5. consumed 後 re-verify (replay) → not_found
  6. supersede: 再 issue で旧 active consumed、active 1 件不変 (unique index)、旧コード verify → invalid_code/not_found
  7. **email binding**: A 発行コードを B で verify → not_found
  8. cross-company: c1 のコードを c2 で verify → not_found
  9. 成功時 audit_logs 1 行 (kind=customer_email_verify)
  10. rate guard: ISSUE_RATE_MAX 回 issue 後 → rate_limited
  11. concurrent-ish: 2 連続 issue で active 行が常に 1 件 (unique index)

## .env.example
- `RESERVATION_VERIFICATION_CODE_PEPPER=<32+ random hex>` を追記 (fail-fast、>=16 chars)。**本番/dev/CI で要設定**。

## spec 更新
- `spec/data-model.md`: §3.x `reservation_verification_codes` 追加 (create-on-confirm 帰結・HMAC/binding/低エントロピー防御・partial unique index・migration 順序 §17)。`未配線: email 6 桁コード検証 (step6-7) は A.32` 行を A.32a done(security core)/A.32b pending に更新。

## adversarial gate (Phase 64-A.26 #1)
| # | 条件 | 該当 | 対応 |
|---|---|---|---|
| 1 | raw-migration | **該当** (0025) | 敵対的レビュー済み (workflow) |
| 2 | 新規署名鍵/session | **該当** (HMAC pepper) | レビュー推奨で導入、env fail-fast、最終 review で鍵取扱い確認 |
| 4 | 金銭/billing | なし | |
| 5 | cross-tenant boundary | **該当** | email binding + company scope を構造強制、cross-company テスト |

## 実装レビュー反映 (code-reviewer + Codex 並走、design-review に続く 2 巡目)

実装後の並走レビューで以下を反映 (CRITICAL 0):
- **[Codex HIGH] RLS 欠落 → 修正**: 0025 に `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (canonical 踏襲) 追加。未有効だと Supabase anon が PostgREST 経由で attempt_count 改ざん (ロック回避) / 既知 code_hash 注入 (検証偽装) 可能だった。adversarial gate #3 (新規 RLS policy) 該当だが canonical verbatim 再利用。
- **[code-reviewer HIGH] attempt_count UPDATE 0 行フォールバック → throw に変更**: FOR UPDATE ロック済みで 0 行は並行不変条件違反。メモリ値代用は DB 未永続のまま locked/invalid を返し試行制限を崩すため fail-fast。
- **[code-reviewer MEDIUM] IssueResult に `email` (正規化済み) 追加**: 設計 plan に対し実装が追加。A.32b が正規化 email を再計算せず送信/再 verify に使える利点。無害・採用。
- **[LOW] rate-guard window-reset テスト追加** (integration test 12)。
- nested tx (savepoint) 動作は integration test 11/12 の実行で確認 (postgres-js は SAVEPOINT 対応、既存 token service-role test が同パターンで成立済み)。

## 運用 action item (要ユーザー対応)
1. **migration 適用**: `npm run db:apply-raw:post` (0025 のみ APPLY、他は SKIP)。**live/shared DB への schema 変更のため Claude は実行不可 (classifier 拒否) → ユーザー認可/実行が必要**。適用後に integration テスト実行。
2. **env 設定**: `RESERVATION_VERIFICATION_CODE_PEPPER` (>=16 文字のランダム値) を `.env.local` / CI / 本番に設定。未設定だと issue/verify が fail-fast (.env.example は permission 上 Claude 編集不可のため本 handoff で明記)。

## A.32b 引き継ぎ契約 (本 plan で固定)
1. route は `verifyVerificationCode` を `createPublicReservation` 前に呼び、`verifiedEmail` を予約 customer.email に使う (クライアント送信 email を信用しない)。
2. 公開 email を必須化 (公開専用 refine、共有 customerInputSchema は不変)。
3. not_found/invalid_code/expired/locked はクライアント文言統一 (oracle 緩和, review LOW#9)。
4. **本番露出は A.33 (Turnstile + 送信レート制限) 完了が hard 依存**。
5. email 送信は outbox 経由 (issue が返す生 code を載せる)。
