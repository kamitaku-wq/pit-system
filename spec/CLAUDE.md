# CLAUDE.md

## Project

整備ピット予約・店間整備・業者通知システム（販売会社単位 SaaS）

## Doc Sources

このプロジェクトでは、以下のドキュメントを最優先で参照すること。すべてリポジトリルートに配置されている。

- `requirements.md` v2.2（要件定義、真の源）
- `implementation-plan.md` v2.2（Phase 構成・PoC・工数感）
- `data-model.md` v2.2（DB スキーマ・RLS・マイグレーション順序）
- `screen-list.md` v2.2（画面一覧・モバイル・印刷）
- `verification-checklist.md` v2.2（受入テスト・異常系シナリオ）

## Current Goal（v2.2 で設定）

**直近のゴール**: 中古車販売会社（多店舗展開、経営層）向けの **営業資料（提案書 + UI デザイン）** を作成。実装段階にはまだ入らない。

- **UI 作成方針**: グローバル CLAUDE.md のデフォルト（パターン C: Codex Image）を本プロジェクトでは上書き → **Claude Design で本番品質の UI を先に作成**（実装ズレ防止）。
- **資料の装飾**: OpenAI 画像生成（DALL-E / Codex Image）でビジュアル素材を作成。
- **資料構成**: ページ構成・内容は Claude が決定、機能面とわかりやすさ重視。

## Critical Rules

- 要件を勝手に削除しない
- 要件を勝手に別仕様へ編集しない
- MVP で実装しない機能も将来要件として残す
- 不明点は TODO として残す（`requirements.md` §33 など）
- 設定画面・マスター管理を重視する
- シンプルな画面設計を維持する
- 拡張しやすいドメイン設計にする

## 確定事項（v2 + v2.1 で決定）

### 設計判断（8 項目）

| 項目 | 確定 |
|---|---|
| テナント単位 | 販売会社（法人）単位、**全テーブルに `company_id`**（中間/履歴含む） |
| 業者 | デフォルト専属、将来共有可、`is_shared` CHECK trigger |
| 業者対応可後 | 依頼種別で切替、デフォルト自動確定 |
| 移動パターン | 片道 / 往復 / 引取のみ / 三点移動すべて、**DB CHECK で整合保証** |
| 顧客予約 | MVP に含む（email 認証コード + 署名トークン） |
| **MVP 定義（v2.1）** | **Phase 0-4 全体 = MVP、Phase 2 = MVP コア** |
| **案件単位招待（v2.1）** | **MVP に含む**、`transport_order_invitations` |
| **同時編集（v2.1）** | **楽観排他**（`version` カラム + IF MATCH） |

### 技術スタック

Next.js (App Router) + TypeScript / PostgreSQL (Supabase Tokyo) / Drizzle / Supabase Auth（社内・業者のみ） / Resend + React Email / Inngest + Vercel Cron / shadcn/ui + Tailwind + FullCalendar

詳細は `implementation-plan.md` §1。

### 必須補強（Codex 第二意見 + v2.1 総合レビュー反映）

- DB outbox + `idempotency_key UNIQUE`（通知信頼性）
- **outbox 取得は `FOR UPDATE SKIP LOCKED`**（v2.1、二重送信防止）
- exclusion constraint + tstzrange + gist（予約排他）
- service 関数 + `drizzle.transaction()`（TX 境界）
- `*_status_history` append-only + `status_transitions` マスター + **DB trigger 最終防衛線**（v2.1）
- 業者対応不可フォールバック（次候補 / 希望日時変更 / 手動切替 / キャンセル）
- 顧客は Supabase Auth user にせず `customer_reservation_tokens` で本人確認
- `vendor_users` 分離 + RLS helper function + **company_id 同期 trigger**（v2.1）
- 監査ログ全件 append-only + **PII redaction policy**（v2.1）
- **`notification_deliveries`（配送ログ）と `vendor_portal_inbox`（未読/既読）を分離**（v2.1）
- **`transport_order_invitations` で複数業者打診・スポット業者対応**（v2.1）
- **楽観排他 `version` カラム** で同時編集競合検出（v2.1）
- **service_role は Inngest worker / migration / 顧客 token 検証 / 監査クリーンアップに限定**（v2.1）

## Most Important Feature

店間整備予約で車両の店間移動が発生した場合、回送・陸送業者マスターに登録されている業者へ、**DB outbox 経由でメール通知と業者用マイページ通知を確実に自動送信** すること。

- 業者はマイページで依頼確認、対応可否、引取 / 搬入 / 返却予定の入力、完了報告、備考入力ができる
- 店舗側は業者の確認状況、対応可否、進捗、店舗確定状況（store_confirmed_at）を確認できる
- 業者が「対応不可」を返した場合、店舗側で **次候補業者への打診 / 希望日時変更 / 手動切替 / キャンセル** が可能
- 通知失敗時は outbox に `status='failed'` で停留 → 運用画面から手動再送可

## Phase 構成

| Phase | 内容 |
|---|---|
| 0 | 基盤 PoC（RLS / 並列予約 / outbox / retry / runtime） |
| 1 | マスター設定 + 認証基盤 |
| 2 | 店間移動 + 業者通知ループ（縦切り MVP の核） |
| 3 | カレンダー + 整備伝票 + 車両管理 |
| 4 | 顧客予約 + 本人確認 + 通知拡張（LINE / SMS / リマインド） |
| 5 | 将来拡張（請求 / OCR / 在庫 / 自社ローン等） |

詳細は `implementation-plan.md` §3。

## Implementation Discipline

実装に着手する前に必ず：

1. `requirements.md` v2.2 で対応する要件番号を確認
2. `data-model.md` v2.2 で関連テーブル・制約・RLS を確認（特に §17 マイグレーション順序）
3. `implementation-plan.md` v2.2 で該当 Phase の前提と service 関数の責務を確認
4. `verification-checklist.md` v2.2 で完了基準と異常系シナリオを確認

実装は **service 関数 + `drizzle.transaction()`** で囲み、Server Actions は薄い入力検証層に留める。RLS は DB が境界を強制するが、アプリ側でも権限を再確認する（多層防御）。

### v2.1 で必須の実装パターン

- UPDATE は **`WHERE id = ? AND version = ?` の IF MATCH** + `SET version = version + 1`
- outbox dispatcher は **`SELECT ... FOR UPDATE SKIP LOCKED`**
- 通知は必ず **`notification_outbox` 経由**、`Resend` の直叩き禁止
- 監査ログは **`redact_audit_payload()` 経由**、生 PII の保存禁止
- 業者ポータルは **vendor_users 認証**、`auth.users` テーブル直叩き禁止
- 顧客は **`customer_reservation_tokens` の hash 検証**経由のみ

## 関連 ADR

- ADR-0001 テナントモデル（販売会社単位、RLS）
- ADR-0002 通知配送（DB outbox + Inngest + FOR UPDATE SKIP LOCKED）
- ADR-0003 状態遷移管理（status_transitions + DB trigger + TS map）
- ADR-0004 業者ポータル認可境界（vendor_users + helper function）
- ADR-0005 顧客本人確認（token table、Auth user 化せず）
- ADR-0006 予約枠排他（exclusion constraint）
- ADR-0007 楽観排他（version + IF MATCH）（v2.1）
- ADR-0008 案件単位招待と先着受注（v2.1）
- ADR-0009 PII redaction + 監査ログ append-only（v2.1）
- ADR-0010 service_role 使用範囲（v2.1）
