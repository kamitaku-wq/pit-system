# CLAUDE.md

## Project

整備ピット予約・店間整備・業者通知システム（販売会社単位 SaaS）

## Doc Sources

このプロジェクトでは、以下のドキュメントを最優先で参照すること。すべてリポジトリルートに配置されている。

- `requirements.md` v2.2（要件定義、真の源）
- `implementation-plan.md` v2.2（Phase 構成・PoC・工数感）
- `data-model.md` v2.4（DB スキーマ・RLS・マイグレーション順序）— 2026-05-23 audit-coverage D-1/D-4 反映 (customers.phone_verified_at / service_tickets.quoted_amount_minor + tax_rate_bps + billing_status enum)
- `screen-list.md` v2.2（画面一覧・モバイル・印刷）
- `verification-checklist.md` v2.2（受入テスト・異常系シナリオ）
- `roadmap/roadmap.md` v1.1（alpha-core 4 Sprint + mvp-release 適応プラン）
- `roadmap/{risks,dod-checklist,dependency-graph}.md` v1.x（リスク/検収/依存）
- `audit/audit-{structure,coverage,quality}.md`（2026-05-23 4 レーン監査結果）
- `decisions-draft-2026-05-23.md` v2 / `codex-review-decisions-2026-05-23.md`（TODO 11 件確定経緯）

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

### ADR-0010 補項 (Phase 24 追加、Phase 25 minor 拡張)

vendor invitation token verification/onboarding server route も service_role 利用境界に追加:

- 対象: `src/app/(vendor-portal)/vendor/invitations/**` 配下の server-only action / route handler (Phase 25 で `[token]/*` から `**` に拡張、callback route を含める)
- 利用範囲: token hash 照合、`auth.admin.inviteUserByEmail`、`vendor_users` INSERT、callback での `vendor_users.is_active=true` flip + `last_login_at` 更新 (vendor portal user は `current_user_company_id()` で RLS 越え不可のため)
- 制約: client component / RPC 内では service_role 利用禁止 (既存規律維持)
- `src/app/(admin)/vendors/invite/actions.ts` — admin 招待 server action。`getConfiguredSupabaseAdmin()` 経由で `createAdminVendorInvitation()` を呼び出す。RLS bypass が必要なため service_role client 使用。
- `src/app/(vendor-portal)/vendor/admin-invite-callback/route.ts` — vendor 側 accept callback。drizzle db client が RLS bypass で `vendor_users` + `admin_vendor_invitations` を UPDATE。
- `src/lib/supabase/admin.ts` — service_role client 共通 helper。`getConfiguredSupabaseAdmin()` を提供。
- Phase 31-C S7: `audit_logs` RLS cross-tenant SELECT で `admin_vendor_invitations` 行が別テナント user に見えないことを確認。
- Phase 31-C S7: `admin_vendor_invitations` INSERT smoke で `audit_logs` に email/name マスク済み payload が記録されることを確認。

### ADR-0010 補項 (Phase 64-A.23 追加: 顧客 token 検証 wrapper)

顧客 facing flow も service_role 利用境界に追加 (spec/data-model.md §14.5-14.6 準拠):

- `src/lib/services/customer-reservation-tokens.ts` — `verifyAndConsumeTokenViaServiceRole(rawToken, opts)` を export。顧客は Supabase Auth user ではないため company scope を引数で受け取れず、token hash から company を導出する。RLS bypass の drizzle `db` (`src/lib/db/client.ts`) 上で 1 tx 内に SELECT (company 取得) → atomic UPDATE+RETURNING → 成功時のみ `audit_logs` INSERT (`action='update'`, `actor_kind='system'`, `after_json.kind='customer_verify_consume'`) を実行。
- `src/app/r/[token]/page.tsx` + `src/app/r/[token]/actions.ts` — 顧客 facing route。`export const dynamic='force-dynamic'`。server action `viewReservationByTokenAction` が wrapper を呼ぶ。
- 制約: 失敗時 (`not_found`/`expired`/`used`/`revoked`) は companyId 不明のため監査ログを残さない (`audit_logs.company_id` NOT NULL 制約による)。`audit_logs.action` の CHECK 制約は (`'create'`,`'update'`,`'delete'`,`'restore'`) のため、token consume は `action='update'` で記録し、`after_json.kind` で区別する。
- token は URL に直接乗る (256-bit 単発 use)。Vercel logs / Referer sanitize は Phase 4 後段で強化検討。
- Phase 4 統合: 顧客 facing 詳細 UI (店舗名・メニュー・車両等) と attachments Storage 連携 (signed URL 発行) を予定。

## v2.3 再凍結 (2026-05-23)

Phase 1 sealed 後、Sprint α-0 着手前に 4 レーン監査 (Codex 並列) を実施し致命/重要を全件修正:

- 監査結果: Critical 14 + High 16 (構造/網羅/品質/adversarial)
- Lane 4 adversarial 結論: 5/31 production release 確度 12%、6/15 slip 推奨
- Tier 1 修正 (10 件): §A.8.11 用語違反 7 件除去 / migration §17 順序修正 (helper→rls→trigger) / ADR-0008 確定 (accept_invitation_and_revoke_others DB 関数) / requirements §33 v1 残置除去 / helper 名 current_user_company_id 統一 / PoC 11→16 / migration 35→46 / LINE/SMS Phase 5 (channel abstraction は Phase 4)
- Tier 2 修正 (5 件): vendor_selection_logs 新規定義 (業者選定監査) / billing_records は Phase 5 (vendor_billings 仮称) / service_slots は既存代替 (reservation_settings + lanes) / service_tickets/vehicles/reservation 最小 CRUD を alpha-core scope 追加 / Sprint α-3 段階デプロイ化 (staging を α-2 末に前倒し)
- 用語境界整理: **alpha-core** (Phase 2 縦切り) / **mvp-release** (Phase 0-4 完走 = MVP 正式定義)
- 次セッション着手前必読: spec/audit/audit-*.md (3 ファイル) + decisions-draft-2026-05-23.md v2
