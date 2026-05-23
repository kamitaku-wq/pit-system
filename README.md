# PIT System

中古車販売会社向けの整備ピット予約・店間整備・業者通知システム。販売会社単位の SaaS として提供し、各拠点のピット稼働を可視化しつつ、店舗間の整備依頼フローと外部業者への通知を一元管理する。

フロントエンドは Next.js 15 (App Router)、バックエンドは Supabase (PostgreSQL)、ORM は Drizzle、バックグラウンドジョブは Inngest、トランザクションメールは Resend で構成する。

## 必読ドキュメント

Sprint α-0 着手前に以下を必ず確認すること。

| ドキュメント | 概要 |
|---|---|
| [spec/CLAUDE.md](spec/CLAUDE.md) | プロジェクト全体概要・確定事項 |
| [spec/data-model.md](spec/data-model.md) | v2.4 DB スキーマ (46 テーブル) |
| [spec/roadmap/roadmap.md](spec/roadmap/roadmap.md) | v1.1 Sprint 構成 |
| [spec/audit/](spec/audit/) | 4 レーン監査結果 |
| [phase-handoff/phase-1.md](phase-handoff/phase-1.md) | Phase 1 sealed handoff |

## 技術スタック

| レイヤー | 技術 | バージョン |
|---|---|---|
| フレームワーク | Next.js | 15 |
| UI ランタイム | React | 19 |
| 言語 | TypeScript | 5.7 |
| スタイル | Tailwind CSS | v4 beta |
| ORM | Drizzle ORM | 0.36 |
| DB / Auth | Supabase (PostgreSQL) | — |
| バックグラウンドジョブ | Inngest | 3 |
| トランザクションメール | Resend | 4 |

## ローカル開発セットアップ

### 前提

- Node.js 20.11+
- pnpm 9.15+
- 外部サービスアカウント: Supabase / Resend / Inngest / Cloudflare Turnstile

### 手順

```bash
# 1. 依存関係インストール
pnpm install

# 2. 環境変数ファイルを作成し、各値を設定
cp .env.example .env.local
# → 詳細は docs/setup/external-services.md を参照

# 3. DB セットアップ (extensions → schema → helpers/triggers/RLS の 3 段階)
#    pre  : CREATE EXTENSION (Drizzle schema より先に必須)
#    main : Drizzle schema migrations 適用
#    post : helper function / trigger / RLS policy / exclusion constraint
pnpm db:setup
# ※ 個別実行は: pnpm db:apply-raw:pre / pnpm db:migrate / pnpm db:apply-raw:post

# 4. Drizzle schema を更新する場合は再生成
pnpm db:generate   # schema 変更時のみ
pnpm db:migrate    # migration 適用

# 5. 開発サーバー起動
pnpm dev

# 6. 別ターミナルで Inngest ローカル dev server 起動
pnpm inngest:dev
```

> **Note**: ESLint 設定ファイル (`eslint.config.mjs`) は初回 `pnpm lint` 実行時に Next.js が自動生成する。

## ディレクトリ構造

```
pit_system/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (admin)/            # 管理者向けルートグループ
│   │   ├── (customer)/         # 顧客向けルートグループ
│   │   ├── (vendor)/           # 業者向けルートグループ
│   │   └── api/                # API routes (Inngest webhook 等)
│   ├── components/
│   │   └── ui/                 # shadcn/ui コンポーネント
│   ├── lib/
│   │   ├── db/                 # Drizzle schema + raw migrations + client
│   │   ├── auth/               # Supabase Auth ヘルパー
│   │   ├── inngest/            # Inngest client + functions
│   │   ├── resend/             # Resend client + email templates
│   │   └── i18n/               # 国際化 (ja 基本)
│   └── server/
│       ├── actions/            # Next.js Server Actions
│       └── services/           # ビジネスロジック
├── drizzle/                    # drizzle-kit 生成マイグレーション
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── spec/                       # 仕様ドキュメント
├── phase-handoff/              # Phase sealed handoff
└── docs/                       # 開発者向けドキュメント
```

## スクリプト一覧

| コマンド | 説明 |
|---|---|
| `pnpm dev` | Next.js 開発サーバー起動 (http://localhost:3000) |
| `pnpm build` | プロダクションビルド |
| `pnpm start` | プロダクションサーバー起動 |
| `pnpm lint` | ESLint 実行 (初回で設定ファイル自動生成) |
| `pnpm typecheck` | TypeScript 型チェック (`tsc --noEmit`) |
| `pnpm format` | Prettier でコード整形 |
| `pnpm format:check` | Prettier フォーマット確認 |
| `pnpm db:generate` | Drizzle schema から migration ファイル生成 |
| `pnpm db:migrate` | Drizzle migration を DB に適用 |
| `pnpm db:push` | schema を DB に直接 push (開発時のみ) |
| `pnpm db:studio` | Drizzle Studio 起動 |
| `pnpm db:apply-raw:pre` | pre-schema raw SQL (CREATE EXTENSION) を適用 |
| `pnpm db:apply-raw:post` | post-schema raw SQL (helpers / triggers / RLS / exclusion) を適用 |
| `pnpm db:setup` | DB セットアップ全段階 (pre → migrate → post) 一括実行 |

### DB セットアップの注意点

- **`src/lib/db/raw-migrations/manual/` 配下は手動実行が必要**: `auth.users` テーブルへの trigger 等、Supabase の `supabase_auth_admin` ロール権限が必要な操作は `pnpm db:setup` で自動実行されない。Supabase Dashboard > SQL Editor (superuser) で個別実行し、`INSERT INTO _raw_migrations (filename) VALUES ('0006_auth_trigger.sql');` を手動で追記する。
- **再実行時の注意**: `_raw_migrations` テーブルが適用済をトラッキングするため、通常の再実行は安全 (SKIP される)。ただし `_raw_migrations` を手動でリセットしたり、`psql -f` で SQL を直接流すと、`CREATE TRIGGER` / `CREATE POLICY` は `OR REPLACE` 非対応のため失敗する。DB を完全リセットする場合は Supabase Dashboard から DB をリセットしてから `pnpm db:setup` を再実行する。
| `pnpm test` | Vitest でユニット・統合テスト実行 |
| `pnpm test:watch` | Vitest ウォッチモード |
| `pnpm test:e2e` | Playwright で E2E テスト実行 |
| `pnpm inngest:dev` | Inngest ローカル dev server 起動 |

## 関連リンク

- **仕様資料 (GitHub Pages)**: https://kamitaku-wq.github.io/pit-system/
