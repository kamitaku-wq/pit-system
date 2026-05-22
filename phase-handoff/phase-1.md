# Phase 1: 設計ドキュメント・UI モック・説明資料 構築 Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 1（設計 + 提案資料作成、実装前段） |
| 状態 | sealed |
| 開始日時 | 2026-05-22 |
| 完了日時 | 2026-05-23 |
| 担当アクター | Claude (設計・統合・執筆) + Codex (独立レビュー複数回) + Claude Design (UI 制作 + HTML 整形) |
| 関連 PR / branch | main / commits a9d43c5, 676fb46 |
| 公開先 | https://github.com/kamitaku-wq/pit-system / https://kamitaku-wq.github.io/pit-system/ |

## このフェーズで達成したこと

- 設計ドキュメント 7 ファイル v2.2 完成（spec/、計 5,500 行超）
- Codex 独立レビュー 4 回反映（致命的指摘 7 / 重要 10 / 補強 5 / 新規 5 = 計 27 件）
- 用語ポリシー §A.8.11 確立（顧客に「他社/マルチテナント/SaaS/is_shared」を露出しないルール）
- Claude Design v1→v2→v3 で UI モック 50 artboards × 7 sections（design/）
- 説明資料 HTML 完成（docs/index.html、2,557 行 / 122 KB / 章 1-6 完成）
- 50 画面の retina 2x スクショ自動取得（Playwright スクリプト docs/scripts/）
- Git リポジトリ初期化 + GitHub 公開 + Pages 有効化
- 提案先（中古車販売会社経営層）に渡せる説明資料 URL 確定

## Claude 側の主要設計判断

1. **テナント単位 = 販売会社（法人）**：店舗グループ単位や単一店舗専用ではなく法人単位。全主要テーブルに `company_id NOT NULL FK`。
2. **顧客は Supabase Auth user にしない**：MAU 課金と認証フロー過剰を回避、`customer_reservation_tokens` で署名トークン本人確認。
3. **通知は DB outbox 必須**：Inngest だけでは恒久重複防止不可、`idempotency_key UNIQUE` + `FOR UPDATE SKIP LOCKED` を併用。
4. **予約排他は exclusion constraint**：アプリ side の find-then-insert を禁止、`gist + tstzrange + btree_gist` で DB が二重予約を構造的に拒否。
5. **同時編集 = 楽観排他（version カラム + IF MATCH）**：last-write-wins ではなく明示的競合検出。重要テーブルのみ適用。
6. **MVP コア = Phase 2 業者通知ループ**：縦切りで先に通す。顧客予約は Phase 4 で MVP の最終段、LINE/SMS は Phase 5。
7. **§A.8.11 用語ポリシー**：BtoB SaaS の鉄則として「貴社専用システム」として見せ、他社 / マルチテナント / SaaS / is_shared を顧客向けに一切露出させない。
8. **説明資料は Claude Design に新チャット委任**：v3 制作チャットの続きでは UI 不一致が発生 → 新チャットで PNG スクショ参照に統一。

## Codex 委任成果

| 委任内容 | 反映先 | 状態 |
|---|---|---|
| v1 設計ドキュメント独立レビュー（致命的 7 件） | spec/* v2 改訂 | applied |
| 技術スタック独立レビュー（補強 5 件：outbox 必須・TX 境界・楽観排他等） | spec/* v2.1 + claude-design-handoff §A.8 | applied |
| v2 総合レビュー（新規 5 件 + 不整合 5 件） | spec/* v2.2 | applied |
| Claude Design 出力 UX 独立レビュー（11 件：PII モック違反・aria 連携・capture・R/W/C 等） | design-v3 制作依頼に反映 | applied |
| v2.1 最終総合レビュー（営業資料化観点） | docs/index.html 構成・spec 表記補強 | applied |

詳細は `~/.claude/telemetry/delegation-ledger.jsonl` を grep 可能。

## 主要ファイル (next phase reference)

- `spec/requirements.md` — 要件定義 v2.2、971 行（§33 未確定事項 11 件）
- `spec/data-model.md` — DB スキーマ v2.2、1,460 行（§17 マイグレーション順序 / §13 KPI view）
- `spec/implementation-plan.md` — Phase 構成 v2.2、644 行（§3 Phase 0 PoC 11 項目）
- `spec/claude-design-handoff.md` — ブランド + §A.8.11 用語ポリシー、1,240 行
- `spec/verification-checklist.md` — 受入テスト + 異常系シナリオ、518 行
- `docs/index.html` — 説明資料本体、2,557 行（GitHub Pages 公開）
- `docs/scripts/screenshot.mjs` — Playwright スクショ再取得スクリプト
- `design/project/` — Claude Design v3 UI モック（50 artboards、React + JSX）

## データモデル変更

未実装フェーズ。spec/data-model.md v2.2 でテーブル定義完了。次 Phase で migration SQL を生成。

主要テーブル（35 個）: companies / users / vendor_users / stores / lanes / work_menus / reservations / service_tickets / transport_orders / transport_order_invitations / notification_outbox / vendor_portal_inbox / audit_logs / 等

## API 契約

未実装。spec/implementation-plan.md §5-6 に service 関数の擬似コード記載。

## テスト・QA 状況

- 未実装フェーズ、テスト計画は spec/verification-checklist.md と implementation-plan.md §10 に記載
- Phase 0 PoC で 16 項目の自動テスト（RLS 漏洩 / 並列予約 / outbox retry / 楽観排他 / capture / 監査ログ redaction 等）を CI 化予定

## 既知の懸念・TODO

spec/requirements.md §33 / implementation-plan.md §16 の 11 件（一部抜粋）:

- [ ] 顧客 SMS 認証を MVP に含めるか（現状 email のみ）
- [ ] 業者 SLA を業者マスター or 依頼種別マスターのどちらに持たせるか
- [ ] 自動マッチングレコメンドの MVP 範囲
- [ ] 月表示カレンダーを Phase 3 / Phase 4 のどちらか
- [ ] PII 匿名化の自動化スケジュール（顧客削除 30 日後想定）
- [ ] Supabase Realtime をどこまで使うか
- [ ] reCAPTCHA / hCaptcha 導入タイミング

## Phase 2 入力契約 (必須)

次セッションで Phase 0 PoC 着手 or 残 TODO の意思決定に進む想定。

### 前提として完了済み
- 設計ドキュメント v2.2（spec/*）すべて確定
- UI モック 50 画面（design/）確定
- 説明資料（docs/）公開済み
- Git + GitHub Pages 稼働

### 最初に読むべきファイル
- `spec/CLAUDE.md` — 全体概要と確定事項（87 行、最初に読む）
- `spec/implementation-plan.md` §3 Phase 0 — PoC 11 項目
- `phase-handoff/phase-1.md` — 本ファイル
- `README.md` — リポジトリ構成

### 絶対に壊してはいけないもの
- §A.8.11 用語ポリシー（顧客向けに「他社」「マルチテナント」「SaaS」「is_shared」露出禁止）
- spec/* の v2.2 確定事項（8 設計判断 + 19 補強）
- docs/index.html の章 1/3/5/6 構造（章 2/4 は Claude Design 出力で差替え可）
- GitHub Pages の公開 URL（/docs フォルダ）

### 推奨される次 Phase スコープ

選択肢:
- **A. Phase 0 PoC 着手**: 技術スタック確定済み、リポジトリ初期化 + Supabase / Vercel / Drizzle のセットアップ
- **B. 残 TODO 11 件の意思決定**: PoC 前に要件詰める
- **C. 提案先への説明資料提出 + フィードバック反映**: 営業活動後の修正対応

### 注意点・コンテキスト
- 実装段階にはまだ入っていない（ユーザー明示）。Phase 2 で実装に入るかは提案先フィードバックや経営判断次第
- Claude Design v3 と spec の整合は維持されている。UI 修正時は v3 既存チャット or 新チャットで PNG 参照方式
- 説明資料の修正は docs/index.html を直接編集 → git commit + push で自動再デプロイ

## Codex ledger refs

このセッションで観測した主要委任 ID（背景タスク notification 経由で記録）:

- del-20260522-001651-eddd（v1 独立設計レビュー）
- del-20260522-005145-3b99（技術スタック独立レビュー）
- del-20260522-024243-40b3（v2 総合レビュー）
- del-20260522-035513-d117（v2.1 最終総合レビュー）
- del-20260522-141931-5972（Claude Design UX 独立レビュー）

詳細は `~/.claude/telemetry/delegation-ledger.jsonl` で grep。

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 commit 数 | 2（initial + README URL 修正） |
| 追加コード行数 | spec ~5,500 / docs ~2,557 / design ~5,800（Claude Design 出力） |
| 主要 commit SHA | a9d43c5（Initial）, 676fb46（README URL） |
| Codex 委任率 | レビューフェーズで 100%（実装委任は未発生、設計のみ） |
| セッション数 | 1（本セッションで完結） |
| GitHub Pages ビルド | 初回 building（送信時点） |

## Phase 振り返りメモ

- うまくいった: Codex 独立レビューで Claude 単独では見逃したバグ（PII モック違反 / capture 属性欠落 / R/W/C 略号など）を捕捉。多モデル併走の価値高い。
- うまくいった: 用語ポリシー §A.8.11（BtoB SaaS の鉄則）はユーザーからの 1 行指摘で確立、v1/v2 で見逃していた重大欠陥を修正。
- うまくいった: Playwright 自動スクショで 50 画面を 3 分で取得、手動撮影の手間を完全排除。
- 改善余地: 「営業資料」と「説明資料」を初期に区別できず、私が 2 回プロンプト集を書き直した（ChatGPT 画像生成 → スライド画像 → 説明資料）。ユーザー指示の解釈は早期に確認すべき。
- 改善余地: Claude Design に v3 既存チャットで説明資料依頼したら UI 不一致が発生。新規依頼は新チャットが基本則。

---

*Generated by phase-handoff skill / Filled by Claude at Phase 1 seal*
