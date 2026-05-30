# Phase 3-env-bootstrap: Sprint α-0 着手前 環境構築 Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 境界 | Phase 2-α-prep (sealed) → 環境構築 (本セッション) → Sprint α-0 PoC 16 項目 (次セッション) |
| 状態 | sealed |
| 担当アクター | Claude (環境構築 + dotenv 修正 + MCP 経由 trigger 適用) + ユーザー (外部サービス契約 + .env.local 編集) |
| 主要 commit | 未 commit (ユーザー判断、推奨: `package.json` + `pnpm-lock.yaml` + 2 ファイル dotenv 化 + 本 handoff) |

## このフェーズで達成したこと

- Supabase project `ljcruianqmfhpdzvfubl` 作成 (region: ap-northeast-1 Tokyo)、5 キー取得、btree_gist + pg_trgm 有効化、Email/Confirm email 有効化
- Resend API key 取得 (sandbox: `onboarding@resend.dev` を `RESEND_FROM_EMAIL`)
- Inngest Event key + Signing key 取得 (production keys、開発時は dev server が intercept)
- `.env.local` 作成 (13 env vars 認識)
- **dotenv 読込問題を発見・修正**: `apply-raw-sql.ts` と `drizzle.config.ts` に dotenv import 追加 (Next.js は自動読込だが tsx / drizzle-kit は手動 load 必要)
- `@next/env` 16.2.6 を試行 → `loadEnvConfig` export 喪失で却下 → `dotenv` 17.4.2 に swap
- `pnpm db:setup` 3 段階 (pre/0001 → drizzle migrate → post/0002-0005) 全成功
- `0006_auth_trigger.sql` を **Supabase MCP `apply_migration` 経由で適用** (Dashboard 手動回避)
- `_raw_migrations` への tracking insert (MCP `execute_sql`)
- `pnpm dev` 起動 + http://localhost:3000 → 200 OK 確認 (Ready in 3.3s, 13304 bytes)
- `next` 15.3.3 → 15.5.18 自動 minor 上昇検出 (caret range)
- `experimental.typedRoutes` → `typedRoutes` API 移動警告検出 (未対応、次 Phase 冒頭で消化)

## Claude 側の主要設計判断

1. **`@next/env` → `dotenv` への swap**: Next.js 16 系の `@next/env` では `loadEnvConfig` が削除。`next` 本体 (15.5.18) に pin する案より、API 安定の `dotenv` 17.4.2 を採用。Next.js の env precedence は `loadDotenv({ path: '.env.local' })` → `loadDotenv({ path: '.env', override: false })` の 2 段読みで近似
2. **`0006_auth_trigger.sql` MCP 経由適用**: Phase 2-α-prep watchpoint #1 では「Dashboard 手動必須」とされていたが、Supabase MCP `apply_migration` が postgres role の十分な権限で auth schema への CREATE TRIGGER 実行可能を確認。今後の `auth.*` 系 DDL は MCP で完結可
3. **Shared Pooler 採用**: Dedicated Pooler / Direct connection は IPv4 非対応で家庭ネットワーク不可。Pro plan の IPv4 add-on ($4/月) より無料の Shared Pooler で性能十分。host: `aws-0-{region}.pooler.supabase.com` / user: `postgres.{project-ref}` / port: 6543 transaction or 5432 session

## Codex 委任成果

本セッションは Codex 委任ゼロ (環境構築 + 小修正中心、6 行追加 × 2 ファイルで Claude 直接実施)。
- dotenv import 追加 (`apply-raw-sql.ts`, `drizzle.config.ts`): Claude 直接
- `0006_auth_trigger.sql` 適用: MCP 経由

## 主要ファイル (next phase reference)

- `package.json` — `@next/env` 削除、`dotenv@17.4.2` 追加、`next` は caret で 15.5.18
- `drizzle.config.ts` — `loadDotenv({ path: '.env.local' })` + `loadDotenv({ path: '.env', override: false })`
- `src/lib/db/apply-raw-sql.ts` — 同上 (dotenv loader)
- `.env.local` — 13 env vars (Supabase 5 + Resend 2 + Inngest 2 + Turnstile 2 placeholder + その他)
- Supabase project: `ljcruianqmfhpdzvfubl` (ap-northeast-1 Tokyo)
  - extensions: pgcrypto + btree_gist + pg_trgm
  - auth: Email + Confirm email 有効化
  - public schema: companies / users / vendor_users + RLS + triggers + helpers
  - auth schema: `trg_on_auth_user_deleted` (`public.sync_user_delete` SECURITY DEFINER)

## 既知の懸念・watchpoint

1. **`experimental.typedRoutes` 警告**: next 15.5 で API が `typedRoutes` (top-level) に移動。`next.config.ts` の 1 行修正で消える。次 Phase 冒頭で消化推奨
2. **`next` 15.3.3 → 15.5.18 自動上昇**: caret range のため pnpm install で minor 上がり。lockfile で再現性は確保
3. **`@react-email/components 0.0.31` deprecated 警告**: react-email エコシステム非互換あり、α-1 で react-email 3.x 現行 API に切替検討
4. **dotenv `injected env (13)` ログ**: 標準出力に出る。Vercel 本番では `process.env` 直接設定のため影響なし
5. **MCP 経由 DDL は migration 履歴が二重管理**: Supabase 側 `supabase_migrations.schema_migrations` と本プロジェクト `_raw_migrations` が分離。手動 DDL を MCP に倣う場合は `_raw_migrations` への INSERT を忘れず

## 次 Phase (Sprint α-0 PoC 16 項目) 入力契約

### 前提として完了済み

- 設計ドキュメント v2.4 (data-model.md), v2.3 (他)、ロードマップ v1.1
- scaffold + vertical slice + Drizzle/raw SQL 分離パターン
- 外部サービス 3 点契約完了 (`.env.local` 13 vars)
- DB 初期化完了 (pre + drizzle + post + manual 全 7 ファイル適用)
- dev server 動作確認済み

### 最初に読むべきファイル

- `CLAUDE.md` — メタルール (日付禁止)
- `spec/CLAUDE.md` — プロジェクト概要・確定事項
- `phase-handoff/phase-3-env-bootstrap.md` — 本ファイル
- `phase-handoff/phase-2-alpha-prep.md` — 設計確定時 handoff
- `spec/roadmap/roadmap.md` §1.2 Sprint α-0 — 16 PoC タスク
- `package.json` scripts

### 絶対に壊してはいけないもの

- メタルール「日付・確度の自発的予測禁止」
- §A.8.11 用語ポリシー (顧客向けに「他社/マルチテナント/SaaS」露出禁止)
- v2.4 で追加した 4 カラム (phone_verified_at / quoted_amount_minor / tax_rate_bps / billing_status)
- DIRECT_URL / DATABASE_URL 用途分離
- RLS UPDATE policy の WITH CHECK 必須
- raw-migrations の pre/post/manual 3 分割
- **dotenv loader の 2 段読み** (`apply-raw-sql.ts` と `drizzle.config.ts`)
- **`@next/env` は不使用** (将来の Next.js アップグレードで壊れる)

### 推奨される次 Phase 着手手順

1. `next.config.ts` の `experimental.typedRoutes` → `typedRoutes` 移動 (警告解消、1 行修正)
2. `spec/roadmap/roadmap.md` §1.2 Sprint α-0 を読込、16 PoC タスクを planner に渡して着手計画立案
3. dev server 再起動: `pnpm dev` (前セッションの background ID `b7pv1qx9f` は無効化)
4. 必要なら別タブで `pnpm inngest:dev`
5. PoC #5 (WITH CHECK テナント脱出 UPDATE 試行) は MCP `execute_sql` で容易に検証可

## Codex ledger refs

本セッション Codex 委任ゼロ、ledger 追加記録なし。

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 外部サービス契約 | Supabase + Resend + Inngest 3 点 |
| env vars | 13 (.env.local) |
| パッケージ swap | `@next/env` 16 削除 → `dotenv` 17.4.2 追加 |
| ファイル編集 | `drizzle.config.ts` + `apply-raw-sql.ts` (各 +5 行) |
| migration 適用 | pre 1 + drizzle 1 + post 4 + manual 1 = 7 |
| MCP DDL/DML | apply_migration 1 + execute_sql 1 (tracking) |
| dev server | Ready in 3.3s, 200 OK, 13304 bytes |
| advisor 呼出 | 0 |

## Phase 振り返りメモ

- うまくいった: Phase 2-α-prep handoff の watchpoint と次 Phase 入力契約が機能、手戻りなし
- うまくいった: Supabase MCP `apply_migration` で auth schema CREATE TRIGGER が実行可能、Dashboard 手動回避
- 改善余地: scaffold 時に dotenv 読込未対応だった。Next.js 標準は `.env.local` 自動読込のため気付きにくく、tsx / drizzle-kit 直接実行時の罠は Phase 2-α-prep で予防できなかった
- 改善余地: `@next/env` 16 試行 → 失敗 → swap の手戻り 1 サイクル。最初から `dotenv` を採用すべき (next 本体に pin しても将来の major up で再壊れリスク)
- 改善余地: `package.json` caret range で `next` が予期せず 15.5 に上昇。alpha-core では `=15.x.y` 固定 pin 検討余地、ただし lockfile で再現性は確保
- 学び: Supabase Shared Pooler 接続文字列構造 (host: `aws-0-{region}.pooler.supabase.com` / user: `postgres.{ref}` / port: 6543 or 5432) は将来別 region project で参照値として有用

---

*Generated by phase-handoff skill / Filled by Claude at Sprint α-0 environment bootstrap seal*
