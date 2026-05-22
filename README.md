# 段取りくん

整備ピット運用と業者連携を、ひとつに。中古車販売会社のための業務クラウドシステムの設計資料・UI モック・説明資料リポジトリです。

## 📂 リポジトリ構成

```
pit-system/
├── docs/      ← 説明資料（HTML ドキュメントサイト、GitHub Pages 公開）
├── design/    ← UI モック（Claude Design 出力、本番デザイン）
└── spec/      ← 設計ドキュメント（要件 / データモデル / 実装計画 等）
```

## 🌐 オンライン説明資料

説明資料は GitHub Pages で公開されています：

**👉 https://kamitaku.github.io/pit-system/**

ブラウザで開くだけで、システム概要・業務シナリオ 8 件・経営層サマリ・画面リファレンス 50 件・用語集・FAQ をすべて閲覧できます。印刷ボタンで PDF 出力も可能。

## 📄 各ディレクトリの中身

### `docs/` 説明資料サイト

| ファイル | 役割 |
|---|---|
| `index.html` | 説明資料本体（単一 HTML、オフライン動作） |
| `assets/screenshots/` | UI スクショ 50 枚（retina 2x PNG） |
| `package.json` + `scripts/screenshot.mjs` | スクショ再取得用の Playwright スクリプト |

### `design/` UI モック（Claude Design 出力）

中古車販売会社向け業務システムのプロトタイプ。React + JSX + デザイントークン、50 artboards × 7 sections のキャンバスで全画面を一覧表示できます。

| ファイル | 役割 |
|---|---|
| `README.md` | Claude Design 公式 README |
| `QUICKSTART.md` | 起動方法と画面一覧 |
| `project/index.html` | エントリーポイント |
| `project/screen-*.jsx` | 画面コンポーネント（管理 / 業者 / 顧客 / 設定 / 印刷） |
| `project/tokens.css` + `tokens.json` | デザイントークン |
| `chats/chat1.md` | Claude Design 制作時の対話履歴 |

起動：

```bash
cd design && npm run dev
# → http://localhost:5175 でデザインキャンバスを開く
```

### `spec/` 設計ドキュメント（v2.2）

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | プロジェクト概要 + 重要決定事項 |
| `requirements.md` | 要件定義（33 章、971 行） |
| `data-model.md` | DB スキーマ + RLS + マイグレーション順序（1460 行） |
| `implementation-plan.md` | Phase 構成 + PoC + 工数感（644 行） |
| `screen-list.md` | 画面一覧（538 行） |
| `verification-checklist.md` | 受入テスト + 異常系シナリオ（518 行） |
| `claude-design-handoff.md` | ブランドガイドライン + 用語ポリシー §A.8.11（1240 行） |

## 🏗️ システム概要

「段取りくん」は中古車販売会社向けのクラウド業務システムです。主要機能は 4 つ：

1. **ピット予約共有** — 全店舗のピット空き状況をカレンダー 1 枚で共有
2. **店間整備予約** — ピットがない店舗から、ピットがある店舗へ即予約
3. **業者通知の自動化** — 店間移動の業者依頼を自動メール + マイページで通知
4. **顧客来店予約** — お客様は 24 時間 Web から予約可能

詳細は `docs/index.html`（オンライン版）または `spec/requirements.md` を参照。

## 🛠️ 技術スタック（予定）

実装フェーズで使用する技術スタック：

- **FW**: Next.js (App Router) + TypeScript
- **DB**: PostgreSQL（Supabase, ap-northeast-1 Tokyo）
- **ORM**: Drizzle
- **認証**: Supabase Auth
- **Mail**: Resend + React Email
- **Jobs**: Inngest（outbox 配送）+ Vercel Cron
- **UI**: shadcn/ui + Tailwind + FullCalendar

詳細は `spec/implementation-plan.md` 参照。

## 📋 現在のステータス

- ✅ 設計ドキュメント v2.2 完成
- ✅ UI モック（50 artboards）完成
- ✅ 説明資料 HTML 完成（GitHub Pages 公開済み）
- ⏳ 実装フェーズ（Phase 0 PoC 着手前）

## 🔒 ライセンス・取り扱い

本リポジトリは段取りくんプロジェクトの開発資料です。設計内容・UI モック・スクショの二次利用についてはプロジェクトオーナーまでお問い合わせください。
