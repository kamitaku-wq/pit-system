# 外部サービスセットアップ

## 概要

このドキュメントは Sprint α-0 の alpha-core 実装を開始する前に必要な外部サービスの準備手順を説明する。各サービスで取得したキーは `.env.local` に設定する。

---

## Supabase (Tokyo region)

**URL**: https://supabase.com/dashboard

### プロジェクト作成

1. 「New project」をクリック
2. **Region は必ず ap-northeast-1 (Tokyo)** を選択（予約の時刻整合性に影響するため）
3. DB password を安全に保管する

### 取得する値と対応 env key

| 取得場所 | 値 | env key |
|---|---|---|
| Settings > API > Project URL | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Settings > API > anon / public | anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Settings > API > service_role | service_role key | `SUPABASE_SERVICE_ROLE_KEY` |
| Settings > Database > Connection string (Transaction) | Pooler URL | `DATABASE_URL` |
| Settings > Database > Connection string (Session) | Direct URL | `DIRECT_URL` |

> **重要**: `SUPABASE_SERVICE_ROLE_KEY` は絶対に `NEXT_PUBLIC_` 化しないこと（クライアントに露出する）。

### Extensions の有効化

SQL Editor で以下を実行する（予約テーブルの exclusion constraint と顧客検索 GIN index に必須）:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### Auth 設定

Authentication > Providers で **Email** を有効化し、「Confirm email」を ON にする（magic link フロー）。

---

## Resend (transactional email)

**URL**: https://resend.com/api-keys

### 手順

1. API Keys ページで「Create API Key」
2. Permissions: **Sending access** で十分
3. **alpha 開発中は sandbox で OK**（独自ドメイン認証は後で実施）

### 取得する値と対応 env key

| 値 | env key |
|---|---|
| API key | `RESEND_API_KEY` |
| from address (sandbox: onboarding@resend.dev) | `RESEND_FROM_EMAIL` |

> sandbox モードでは `onboarding@resend.dev` を from address として利用できる。

---

## Inngest (background job)

**URL**: https://www.inngest.com/dashboard

### 手順

1. 「Create app」でアプリを作成
2. Settings からキーを取得

### 取得する値と対応 env key

| 値 | env key |
|---|---|
| Event key | `INNGEST_EVENT_KEY` |
| Signing key (signkey- prefix) | `INNGEST_SIGNING_KEY` |

> **alpha-core 開発中は `pnpm inngest:dev` でローカル dev server を使う**。  
> production キーは α-3 の本番デプロイ時のみ使用。

---

## Cloudflare Turnstile (bot 対策、Phase 4 用)

**URL**: https://dash.cloudflare.com → Turnstile

### 手順

1. 「Add widget」でサイトを作成
2. Allowed hostname に `localhost` と本番ドメインを追加

### 取得する値と対応 env key

| 値 | env key |
|---|---|
| Site key | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Secret key | `TURNSTILE_SECRET_KEY` |

> **alpha-core 段階では未使用**。Phase 4 の顧客予約フォーム実装時に有効化する。  
> それまでは `.env.local` に placeholder を入れておけば十分。

---

## Vercel (deploy 先、α-3 で使用)

**URL**: https://vercel.com

### 手順

1. GitHub リポジトリを Vercel に連携（Import）
2. Framework Preset: **Next.js** が自動検出される
3. Environment Variables は Vercel ダッシュボードで設定

> **alpha-core 段階では必須ではない**。  
> α-2 末に staging deploy、α-3 で production cutover を予定。

---

## セットアップ完了チェックリスト

Sprint α-0 着手前に以下をすべて完了させること:

- [ ] Supabase プロジェクト作成（region: ap-northeast-1 Tokyo）
- [ ] Supabase から 4 つのキー取得（URL / anon / service_role / DATABASE_URL / DIRECT_URL）
- [ ] SQL Editor で `btree_gist` / `pg_trgm` extension を有効化
- [ ] Supabase Auth で Email (magic link) を有効化
- [ ] Resend API key + from address 取得
- [ ] Inngest event key + signing key 取得
- [ ] `.env.local` を全項目埋める（`cp .env.example .env.local` → 編集）
- [ ] `pnpm install` 完了
- [ ] `pnpm db:setup` 成功 (= pre extensions → drizzle migrate → post helpers/triggers/RLS の 3 段階)
- [ ] `pnpm dev` で http://localhost:3000 が表示されることを確認
