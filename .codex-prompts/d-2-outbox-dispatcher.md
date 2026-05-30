# Codex 委任: D-2 outbox-dispatcher Inngest function

## 目的

`public.notification_outbox` テーブルから pending な通知を 1 分間隔で取り出し、Resend で送信する Inngest function を実装する。Sprint α-1 DoD の最後の残作業。

## 必読資料

1. `scripts/poc-3-run.ts` — PoC #3 の worker パターン (claim → send → mark sent)。**stale recovery は未実装**、D-2 で追加
2. `src/lib/inngest/client.ts` — D-1 で作成済の Inngest client
3. `src/lib/inngest/route.ts` — D-1 で作成済の serve route
4. `docs/setup/external-services.md` — Resend env (RESEND_API_KEY / RESEND_FROM_EMAIL)
5. `phase-handoff/sprint-alpha-1-plan.md` §D-2 — 「outbox-dispatcher (PoC #3 移植、backoff/stale recovery、prepare:false)」

## public.notification_outbox スキーマ (実機確認済)

| 列 | type | NOT NULL | default | 役割 |
|---|---|---|---|---|
| id | uuid | ✓ | gen_random_uuid() | PK |
| company_id | uuid | ✓ | — | tenant scope |
| transport_order_id | uuid | — | NULL | optional FK |
| reservation_id | uuid | — | NULL | optional FK |
| transport_order_invitation_id | uuid | — | NULL | optional FK |
| idempotency_key | text | ✓ | — | Resend Idempotency-Key header に渡す |
| event_type | text | ✓ | — | 業務イベント種別 |
| target_type | text | ✓ | — | 'email' 等 |
| target_id | uuid | ✓ | — | 送信対象 (customer / user / vendor_user の id 等) |
| payload | jsonb | ✓ | '{}' | 送信本文 (`{ to, subject, html, text? }` 想定) |
| status | text | ✓ | 'pending' | pending / processing / sent / failed |
| attempts | int | ✓ | 0 | 送信試行回数 |
| max_attempts | int | ✓ | 5 | 失敗確定の閾値 |
| next_attempt_at | timestamptz | ✓ | now() | 次の試行可能時刻 (backoff 用) |
| sent_at | timestamptz | — | NULL | 送信完了時刻 |
| last_error | text | — | NULL | 最終エラー文字列 |
| scheduled_at | timestamptz | — | NULL | 遅延送信用 |
| processing_started_at | timestamptz | — | NULL | claim 時刻 |
| created_at / updated_at | timestamptz | ✓ | now() | 標準 |

## 実装仕様

### ファイル構成
- 新規 `src/lib/inngest/functions/outbox-dispatcher.ts`
- `src/lib/inngest/client.ts` の `functions` 配列に追加 export
- 必要なら `src/lib/inngest/db.ts` などで postgres client を共通化 (1 file scope なら inline でも可)

### 実装内容

Inngest scheduled function (`cron: "*/1 * * * *"`、id: `outbox-dispatcher`、concurrency limit: 1):

1. **stale recovery** (step.run "stale-recovery"):
   - `status='processing' AND processing_started_at < now() - interval '5 minutes'` の行を `status='pending', processing_started_at=NULL` に戻す

2. **claim batch** (step.run "claim"、tx 内):
   - `SELECT ... WHERE status='pending' AND next_attempt_at <= now() AND (scheduled_at IS NULL OR scheduled_at <= now()) ORDER BY next_attempt_at LIMIT 10 FOR UPDATE SKIP LOCKED`
   - 取得した id 群を `UPDATE ... SET status='processing', processing_started_at=now(), attempts=attempts+1 WHERE id = ANY(...)`

3. **send each** (各行ごと step.run `send-${id}`):
   - `target_type='email'` の場合 Resend SDK で送信:
     - `from = process.env.RESEND_FROM_EMAIL`
     - `to = payload.to` (or `target_id` を逆引き — 今回は payload.to を信頼)
     - `subject = payload.subject`
     - `html = payload.html` / `text = payload.text`
     - `headers: { 'Idempotency-Key': row.idempotency_key }`
   - 成功時: `UPDATE ... SET status='sent', sent_at=now() WHERE id = $1`
   - 失敗時:
     - `attempts >= max_attempts` または error が permanent (Resend 4xx response) → `status='failed', last_error=...`
     - それ以外 → `status='pending', next_attempt_at = now() + backoff (30s * 2^(attempts-1)、max 1h), last_error=...`
   - (target_type が 'email' 以外なら今回は `status='failed', last_error='unsupported target_type'`)

### 設定値

- `BATCH_SIZE = 10`
- `STALE_AFTER_MIN = 5`
- `MAX_BACKOFF_SEC = 3600`
- `INITIAL_BACKOFF_SEC = 30`

### postgres client 注意

- `postgres(databaseUrl, { prepare: false, max: 5 })` (Supabase pooler 対応)
- function 終了時 `await sql.end()` 必須
- `databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL`

### Resend エラー判定

Resend SDK は `{ data, error }` 形式の response を返す。`error` が non-null かつ `error.statusCode` が 4xx (400-499) は permanent。それ以外 (500-599 や network error) は transient (retry)。

### TypeScript 型

- `Resend` SDK を `pnpm add resend` で追加 (D-1 で未追加なら)
- payload は `Record<string, unknown>` で受け、各 field を `String(payload.xxx ?? "")` でガード
- 結果は `{ claimed: number, sent: number, failed: number, retried: number }` を return

## 厳守事項

- `pg_trigger_depth()` recursion 防止は不要 (audit ではない)
- E-2 既存テスト (`record-audit-log.test.ts` 9 ケース) と Phase 11 整合性を破壊しない
- 51 RLS policies / 9 audit triggers / 7 helper 関数を **変更してはいけない**
- SQL 直接書込み禁止 — Inngest function 内のみで完結
- `console.log` でなく Inngest の `logger.info/warn/error` を使う
- env チェック: `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `DATABASE_URL or DIRECT_URL` 欠落時は即 throw

## 検証コマンド

```
pnpm add resend  # 未追加なら
pnpm typecheck
pnpm lint  # 任意 (lint 設定要確認)
```

`pnpm test` の既存 18 件は緑のままを維持 (E-1 8 + E-2 9 + 他)。

## 出力フォーマット

1. 新規 `src/lib/inngest/functions/outbox-dispatcher.ts` 全文
2. `src/lib/inngest/client.ts` の diff (functions 配列に追加した部分のみ)
3. `package.json` の diff (resend 依存追加)
4. typecheck 結果
5. 既存 `pnpm test` 18/18 PASS 維持確認

## 棄却した代替案

- **fetch 直接 Resend API**: SDK の方が Idempotency-Key header 扱いと型がきれい
- **claim と send を 1 step.run でまとめる**: 失敗時のロールバック粒度が荒くなる
- **stale recovery を別 Inngest function に分離**: cron schedule 重複管理コスト > inline コスト
- **Drizzle で書く**: PoC #3 は postgres-js 直叩きで動いている。整合性優先 + transactional claim は raw SQL の方が直接的
