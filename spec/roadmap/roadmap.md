# 段取りくん 全体ロードマップ v1 (2026-05-23)

## 0. メタ

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-05-23 |
| 更新ルール | 毎週金曜 Sprint レビュー時に更新。大きな方針変更は都度更新 |
| 想定読者 | 開発チーム (Claude main + worktree 担当) |
| バージョン管理 | spec/roadmap/roadmap.md を正とする。変更は PR 経由 |

### 関連ドキュメント

| ドキュメント | 用途 |
|---|---|
| spec/requirements.md v2.2 | 機能要件・TODO 11 件 |
| spec/implementation-plan.md v2.2 | Phase 配置・技術設計 |
| spec/data-model.md v2.2 (1728 行・46 テーブル) | テーブル定義・migration 順序 §17 |
| spec/screen-list.md v2.2 (50 画面) | 画面一覧・ルート定義 |
| spec/verification-checklist.md v2.2 | 受入テスト |
| spec/decisions-draft-2026-05-23.md v2 | 設計決定記録 |
| spec/codex-review-decisions-2026-05-23.md | Codex レビュー結果 |
| spec/roadmap/risks.md | リスク登録簿 |
| spec/roadmap/dod-checklist.md | Sprint 検収チェックリスト |
| spec/roadmap/dependency-graph.md | 依存関係 Mermaid 図 |
| phase-handoff/phase-1.md | Phase 1 sealed handoff (2026-05-23) |

### 納期構造

```
2026-05-23  現在 (本ロードマップ策定)
2026-05-31  MVP-α ハード DDL (必達・例外なし)
2026-06-02~ MVP-β 開始 (週次見直し・DDL2 未設定)
```

**MVP-α**: Phase 2 縦切り (業者通知ループ + 最小マスター + 認証) を 5/31 に本番リリース。
**MVP-β**: Phase 0-4 完走。週次 Sprint レビューで計画を柔軟調整。

### 3 レーン定義

| レーン | 環境 | 主担当 | 責務範囲 |
|---|---|---|---|
| Lane Main | メインブランチ / main worktree | Claude | DB migration / RLS policy / outbox 基盤 / 統合判断 / 設計レビュー / マージ責任 |
| Lane A | worktree-A-vendor | Codex 中心 | 業者通知 / vendor portal / SLA override / 通知配送 (Resend) |
| Lane B | worktree-B-ui | Codex 中心 | マスター UI / 顧客予約フロー / 社内管理 UI |

### Codex 委任方針

- CODEX_POLICY=max (30 行閾値) を全レーンで適用
- 強制委任パス: tests/ helpers/ fixtures/ utils/ mocks/ factories/ 配下 10 行以上
- Sprint α では速度優先のため委任率目標 60% 以上
- 委任後は Lane Main (Claude) が必ず diff / test / lint をレビュー

### Sprint 長

| フェーズ | Sprint 長 | 理由 |
|---|---|---|
| MVP-α (5/23-5/31) | 2 日 | ハード DDL まで 8 日・高頻度 sync 必要 |
| MVP-β (6/2~) | 1 週 | 安定フェーズ・週次 Sprint レビューで調整 |

---

## 1. MVP-α 必達計画 (2026-05-23 → 2026-05-31)

### 1.1 スプリント概要

| Sprint | 期間 | 日数 | 目的 |
|---|---|---|---|
| α-0 | 5/23-25 | 2.5 日 | Phase 0 PoC 16 項目で技術リスクをゼロ化 |
| α-1 | 5/26-27 | 2 日 | 46 テーブル migration + outbox 基盤 + RLS helper 本実装 (※ MVP-α 必須サブセット (実装 priority P0/P1) は Tier 2 で別途確定予定) |
| α-2 | 5/28-29 | 2 日 | 業者通知ループ縦切り (MVP-α コア機能) |
| α-3 | 5/30-31 | 2 日 | E2E 検収 + 本番デプロイ + リリース |

---

### 1.2 Sprint α-0: PoC 集中 (5/23-25, 2.5 日)

**目的**: Phase 0 PoC 16 項目で技術リスクをゼロ化 (implementation-plan.md §3 Phase 0 参照)

| Lane | タスク | 担当 | 完了基準 |
|---|---|---|---|
| Main | RLS 漏洩 PoC: vendor_users が他 company の vendors を SELECT できないことを検証 | Claude | テスト fail → policy 修正 → green |
| Main | 並列予約 PoC: exclusion constraint + tstzrange + gist で同時 INSERT 1 件のみ成功 | Claude | 100 並列 INSERT → 1 件成功確認 |
| Main | outbox retry PoC: Inngest dispatcher + FOR UPDATE SKIP LOCKED で重複送信 0 件 | Claude + Codex | 重複送信 0 件確認 |
| Main | tstzrange gist index PoC: 予約テーブルのインデックス有効性確認 | Claude | EXPLAIN ANALYZE でインデックス使用確認 |
| Main | Supabase Tokyo レイテンシ PoC: P95 < 200ms 確認 | Claude | k6 負荷テスト結果 |
| A | vendor portal 認証 PoC: vendor_users 分離 + helper function でアクセス制御確認 | Codex | auth.users 直接アクセス禁止確認 |
| A | Resend メール送信 PoC: テンプレート + 配信確認 | Codex | テスト送信 1 件成功 |
| A | vendor_portal_inbox PoC: 通知フロー (outbox → inbox) の動作確認 | Codex | INSERT → SELECT 一致確認 |
| B | shadcn/ui + Tailwind 設定 PoC + 主要 layout 骨格 | Codex | 開発サーバ起動確認 (pnpm dev) |
| B | FullCalendar 統合 PoC: 日/週 表示 + 予約データ表示 | Codex | カレンダー画面描画確認 |
| B | Cloudflare Turnstile PoC: ボット対策フォーム動作確認 | Codex | verify token 成功確認 |
| Main | migration 順序 PoC: §17 定義順で全 DDL を supabase db push し循環依存なしを確認 | Claude | migration エラー 0 件・全テーブル作成確認 |
| Main | 楽観排他 PoC: version カラム付き UPDATE WHERE version=$x で同時更新 1 件のみ成功 | Claude | 並列 UPDATE → 1 件成功・他は 409 エラー確認 |
| A | 業者対応不可 PoC: vendor_sla_overrides + 不可期間 INSERT で予約ブロック動作確認 | Codex | 不可期間中の予約 INSERT が拒否されることを確認 |
| Main | 先着受注 PoC: 同一スロット同時リクエストで exclusion constraint が 1 件のみ通過 | Claude | 50 並列リクエスト → 1 件成功・49 件 CONFLICT 確認 |
| Main | PII redaction PoC: redact_audit_payload() で個人情報が audit_logs に残らないことを確認 | Claude | SELECT from audit_logs → PII フィールドが hash/null に変換済を確認 |

**DoD**: dod-checklist.md MVP-α §α-0 全項目 ✓

**Sprint 境界 handoff**: PoC 結果サマリ (成功/失敗/要修正) → Sprint α-1 に必要な設計修正パッチ確定

---

### 1.3 Sprint α-1: 基盤確立 (5/26-27, 2 日)

**目的**: 46 テーブル migration + outbox 基盤 + RLS helper を本実装 (※ MVP-α 必須サブセット (実装 priority P0/P1) は Tier 2 で別途確定予定)

| Lane | タスク | 完了基準 |
|---|---|---|
| Main | migration §17 順序通り 46 テーブル DDL を Supabase Tokyo に適用 | 全テーブル作成済・migration 履歴確認 |
| Main | RLS helper function 実装: current_user_company_id / current_vendor_user_id / current_vendor_id | helper を使った policy 動作確認 (ユニットテスト) |
| Main | RLS policy 全テーブル適用: SELECT / INSERT / UPDATE / DELETE 各ロール分離 | RLS 漏洩テスト green |
| Main | outbox dispatcher Inngest function 本実装: FOR UPDATE SKIP LOCKED + retry logic | scheduled job 起動確認 + 重複送信テスト |
| Main | vendor_sla_overrides テーブル + CRUD API 実装 | INSERT / SELECT / UPDATE 動作確認 |
| Main | pii_anonymization_jobs テーブル + Vercel Cron 定義 | cron 起動確認 |
| A | vendor portal 骨格: /vendor/* ルート構造 + middleware (vendor_users 専用認証) | /vendor/dashboard 表示確認 |
| A | vendor_portal_inbox テーブル + 通知受信 API 実装 | POST → DB 保存確認 |
| B | 社内管理 layout + sidebar + 認証 redirect (/admin/*) | /admin/dashboard 表示確認 |
| B | 共通 UI コンポーネント: Button / Input / Table / Badge / Dialog (shadcn/ui) | 開発環境で表示確認 |

---

### 1.4 Sprint α-2: 業者ループ縦切り (5/28-29, 2 日)

**目的**: 業者通知 → portal → 回答 → status 遷移 → 監査 の MVP-α コア機能を縦切り実装

| Lane | タスク | 完了基準 |
|---|---|---|
| A | transport_orders + invitations 生成 API 実装 | 社内から業者招待レコード作成確認 |
| A | notification_outbox 経由 Resend メール送信: 業者宛通知テンプレート | テスト送信成功・DB に outbox レコード |
| A | vendor portal 対応可否回答 UI: 引取/搬入/返却予定日時入力フォーム | フォーム submit → DB 更新確認 |
| A | vendor 同意取得フロー: 初回ログイン時に capture 同意画面 + DB ログ | vendor_users.consent_at に記録確認 |
| A | vendor_sla_overrides 適用ロジック: SLA 期限計算 + アラート条件 | SLA 期限計算テスト green |
| Main | status_transitions trigger 実装: transport_orders の状態遷移バリデーション | 不正遷移 → エラー確認 |
| Main | audit_logs append-only trigger: 全テーブル変更を append のみで記録 | DELETE 試行 → エラー確認 |
| Main | 業者対応不可フォールバック: 次候補選定 / 顧客への希望変更案内 / 手動対応 / キャンセル | 全 4 パス動作確認 |
| B | 社内 UI: 通知履歴一覧 + 業者対応状況ダッシュボード | 一覧表示確認 |
| B | 社内 UI: 進捗ステッパー (見積→入庫→整備→完了) + 各ステップ詳細 | ステッパー全ステップ表示確認 |

---

### 1.5 Sprint α-3: 検収 + リリース (5/30-31, 2 日)

**目的**: E2E テスト + 本番デプロイ + 受入チェックリスト消化 + v0.1.0-alpha タグ

| Lane | タスク | 完了基準 |
|---|---|---|
| Main | E2E (Playwright): 業者通知ループ全パス (通知送信→回答→状態遷移→監査) | 全テスト green |
| Main | E2E (Playwright): RLS 漏洩テスト (クロス会社アクセス拒否確認) | 全テスト green |
| Main | Vercel 本番デプロイ: 環境変数設定 + ビルド確認 | Vercel Dashboard でデプロイ green |
| Main | Supabase 本番 migration: 46 テーブル + RLS + trigger 適用 | migration 履歴確認 |
| Main | smoke test: 本番環境でコア機能 5 項目を手動確認 | 全項目 ✓ |
| Main | verification-checklist.md MVP-α 全項目消化 | チェックリスト全 ✓ |
| Main | release tag v0.1.0-alpha 付与 + GitHub Release notes 作成 | tag push + Release 公開確認 |
| A | 業者向け簡易 onboarding ドキュメント作成 | docs/vendor-onboarding.md 作成 |
| A | vendor portal 最終 UI 調整 + エラーメッセージ整備 | レビュー ✓ |
| B | 社内管理画面 最終 UI 調整 + 操作マニュアル骨格 | docs/admin-manual.md 骨格作成 |

---

## 2. MVP-β 適応プラン (2026-06-02 以降、週次見直し)

DDL2 は未設定。**毎週金曜に Sprint レビュー + 翌週計画を再評価**。
以下は暫定 Sprint 計画。進捗・障害・優先度変更に応じて柔軟に調整する。

### 2.1 Sprint β-1 (6/2-8, 1 週): Phase 3 カレンダー UI

| Lane | タスク | 完了基準 |
|---|---|---|
| Main | service_slots テーブル + 予約枠管理 API | 予約枠 CRUD 動作確認 |
| B | FullCalendar 日/週/月 表示: 店舗別 + レーン別フィルタ | 3 モード表示確認 |
| B | 予約枠ドラッグ移動: 楽観排他 + exclusion constraint 検証 | ドラッグ → DB 反映確認 |
| B | 予約枠クリック: 詳細モーダル + 編集フォーム | モーダル表示・更新確認 |

### 2.2 Sprint β-2 (6/9-15, 1 週): Phase 3 整備伝票 + 車両管理

| Lane | タスク | 完了基準 |
|---|---|---|
| Main | service_tickets テーブル + CRUD API | 伝票 CRUD 動作確認 |
| Main | vehicles テーブル + partial GIN 検索インデックス | 車番検索 P95 < 100ms |
| B | 整備伝票一覧 + 詳細 + 作成 UI | 伝票フロー確認 |
| B | 車両管理 UI: 検索 + 詳細 + 履歴 | 車番検索動作確認 |

### 2.3 Sprint β-3 (6/16-22, 1 週): Phase 4 顧客予約

| Lane | タスク | 完了基準 |
|---|---|---|
| Main | customers テーブル + 署名トークン生成 | トークン生成確認 |
| Main | Cloudflare Turnstile 多層防御: rate limit + IP ブロック | 連続 POST → 429 確認 |
| B | 顧客予約フロー UI: 車番入力 → 日時選択 → 確認 → 完了 | フルフロー動作確認 |
| B | メール認証フロー: 署名付き確認メール → 予約確定 | 認証リンク経由確定確認 |

### 2.4 Sprint β-4 (6/23-29, 1 週): Phase 4 通知拡張 + リリース準備

| Lane | タスク | 完了基準 |
|---|---|---|
| Main | PII 匿名化 cron (pii_anonymization_jobs): 期限切れデータの匿名化 | 匿名化実行確認 |
| Main | 経理証跡 view: billing_records + 月次集計 | SELECT 動作確認 |
| A | LINE/SMS 通知拡張: Twilio Webhook 統合 | テスト送信確認 |
| A | notification_outbox チャネル拡張: email / line / sms ルーティング | 各チャネル送信確認 |
| Main | リリース準備: v1.0.0 tag + changelog + migration freeze | tag push 確認 |

---

## 3. レーン運用ルール

### 3.1 worktree 管理

```bash
# worktree 作成
git worktree add ../pit_system-A-vendor feature/lane-a-vendor
git worktree add ../pit_system-B-ui feature/lane-b-ui

# worktree 確認
git worktree list
```

| worktree | ディレクトリ | ブランチ |
|---|---|---|
| Lane Main | pit_system/ | main |
| Lane A | pit_system-A-vendor/ | feature/lane-a-vendor |
| Lane B | pit_system-B-ui/ | feature/lane-b-ui |

### 3.2 マージ手順

各 Sprint 末に Lane Main へ rebase merge (FF only):

```bash
# Lane A のマージ例
git checkout main
git rebase feature/lane-a-vendor
git merge --ff-only feature/lane-a-vendor
```

### 3.3 衝突回避ルール

| ルール | 詳細 |
|---|---|
| migration ファイルは Lane Main のみ | Lane A / B は migration ファイルを作成・編集しない。DB 変更要望は Lane Main に依頼 |
| 共通 util / types は Lane Main 承認後 | Lane Main が /src/lib/ /src/types/ を更新後、A/B が import 可 |
| 同一コンポーネントの重複編集禁止 | Sprint 計画時に各コンポーネントの担当 Lane を明示。重複時は Sprint α-1 以降で事前分担 |
| RLS policy は Lane Main のみ | Supabase policy の変更は必ず Lane Main 経由でレビュー |

### 3.4 Codex 委任ルール (全レーン共通)

- CODEX_POLICY=max (30 行閾値) を全レーンで適用
- 強制委任パス: tests/ helpers/ fixtures/ utils/ mocks/ factories/ 配下 10 行以上は委任必須
- 委任後は Lane Main (Claude) が必ず差分・テスト・lint をレビュー
- 委任キャンセル条件: auth / migration / payment / 不可逆操作 (Claude 判断で引き取り)

---

## 4. Sprint 検収ゲート

各 Sprint 末は Lane Main (Claude) が以下を判定する:

### 4.1 共通 DoD (全 Sprint)

| # | チェック項目 | 確認方法 |
|---|---|---|
| 1 | dod-checklist.md の当 Sprint 全項目 ✓ | チェックリスト参照 |
| 2 | Sprint 固有タスク表の全タスク完了 | 本ロードマップのタスク表参照 |
| 3 | 次 Sprint の入力契約クリア | Sprint handoff メモ確認 |
| 4 | risks.md の新規リスク追加 (あれば) | リスク登録簿更新確認 |
| 5 | RLS 漏洩テスト green (Lane Main が毎 Sprint 実行) | テスト結果確認 |
| 6 | lint + typecheck green | CI 結果確認 |

### 4.2 失格時の対応

| 状況 | 対応 |
|---|---|
| スコープ未消化 | 対象機能を次 Sprint に後ろ倒し + risks.md に記録 |
| MVP-α DDL slip | **例外なし・不可**。スコープを縮小して DDL を死守 |
| MVP-β DDL slip | 許容。週次 Sprint 計画で翌週に繰り越し |
| 重大バグ発見 | Sprint を一時停止 + 原因特定 + risks.md にインシデント記録 |

---

## 5. 進捗ダッシュボード (週次更新)

| Sprint | 期間 | 完了タスク数 | 残タスク数 | リスク状況 | 次 Sprint 入力 |
|---|---|---|---|---|---|
| α-0 | 5/23-25 | TBD | TBD | TBD | PoC 結果サマリ |
| α-1 | 5/26-27 | - | - | - | 全テーブル migration 確定 |
| α-2 | 5/28-29 | - | - | - | 業者ループ縦切り完了 |
| α-3 | 5/30-31 | - | - | - | v0.1.0-alpha リリース |
| β-1 | 6/2-8 | - | - | - | カレンダー UI 完了 |
| β-2 | 6/9-15 | - | - | - | 整備伝票完了 |
| β-3 | 6/16-22 | - | - | - | 顧客予約完了 |
| β-4 | 6/23-29 | - | - | - | v1.0.0 リリース |

---

## 6. 技術スタック参照

| カテゴリ | 採用技術 |
|---|---|
| フロントエンド | Next.js (App Router) + TypeScript |
| UI | shadcn/ui + Tailwind CSS + FullCalendar |
| バックエンド | Supabase (PostgreSQL + Auth + Storage) / Tokyo リージョン |
| ORM | Drizzle ORM |
| メール送信 | Resend |
| 非同期処理 | Inngest + Vercel Cron |
| ボット対策 | Cloudflare Turnstile |
| デプロイ | Vercel |

---

## 7. 関連ドキュメント索引

| ドキュメント | 参照タイミング |
|---|---|
| spec/roadmap/risks.md | Sprint 検収時・リスク発生時 |
| spec/roadmap/dod-checklist.md | Sprint 検収時 |
| spec/roadmap/dependency-graph.md | Lane 分担変更時・依存確認時 |
| spec/requirements.md §33 v2 | TODO 11 件の進捗確認時 |
| spec/implementation-plan.md §16 v2 | Phase 配置・技術詳細確認時 |
| spec/data-model.md v2.2 §17 | migration 順序確認時 |
| spec/verification-checklist.md | MVP-α 受入テスト実施時 |
| phase-handoff/phase-1.md | Phase 1 sealed 内容確認時 |

---

*v1: 2026-05-23 Claude + Codex 協調作成*
*次回更新: 2026-05-30 (Sprint α-2 末) 予定*
