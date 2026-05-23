# 未確定 TODO 11 件 意思決定 v2 確定 (2026-05-23)

> 入力: `requirements.md` §33 v1 + `implementation-plan.md` §16 v1
> 経緯: v1 Claude 単独推奨 → Codex 第二意見 (`codex-review-decisions-2026-05-23.md`) → v2 確定
> 反映先: `requirements.md` §33 v2 / `implementation-plan.md` §16 v2 / `data-model.md` v2.2 (vendor_sla_overrides / pii_anonymization_jobs / phone_normalized / partial GIN / ADR-0009 補強)
> 経営判断マーク: 🏢 = 経営層 / 営業 PoC 後再評価

## v1 → v2 差分サマリ

Codex 指摘 11 件 (致命 1 + 重要 8 + 補強 2) すべて反映。主要変更:

| # | v1 推奨 | Codex 指摘 | v2 確定 |
|---|---|---|---|
| 1 | email のみ | 店舗代行 / なりすまし対策弱 (重要) | email のみ + Phase 4 で `phone_verified_at` / 不達手動確定 / 電話番号レート制限 |
| 2 | `vendor_sla_overrides` | **company_id 欠落 + sla_minutes 単独表現不能 (致命)** | company_id 必須 + effective_from/until/is_active + UNIQUE (company_id, vendor_id, work_category_id) + SLA は応答期限のみ (休日は availability マスター) |
| 3 | 推奨マーク ◎○△ | 根拠不透明 + コールドスタート (重要) | 内訳カラム明記 (対応店舗/曜日/応答率/対応不可率) + 新規業者バッジ + `vendor_selection_logs` で監査 |
| 4 | 月次 CSV まで | 電帳法 / インボイス / billing_status 未確認 (重要) | 月次 CSV + Phase 1-2 で金額カラム分割 (estimated/quoted/billed/tax_rate_bps/tax_included) + billing_status enum + Phase 5 着手前法令確認 |
| 5 | Phase 3 末 | §28.1 と矛盾 (重要) | Phase 3 末 + §28.1 修正済み (「Phase 4 後ろ倒し可」削除) |
| 6 | `store_settings.display_columns_json` | **store_settings テーブル不在 (重要、事実誤認)** | **JSONB 先行用意撤回**。MVP 固定列のみ。Phase 5 で `user_table_view_settings(company_id, user_id, table_key, columns_json, sort_json, filter_json)` 新設 |
| 7 | 3 テーブル GIN | PII 残存 (重要) | partial GIN (`WHERE deleted_at IS NULL`) + `customers.phone_normalized` GENERATED + 検索ログ PII 除外を ADR-0009 補強 |
| 8 | 30 日 cron + 監査ビュー 5 年 | **監査ビューが匿名化と矛盾 (重要)** | 30 日 cron + 経理証跡は `anonymized_customer_key` + 伝票番号 + 車両 ID + 金額。`pii_anonymization_jobs.legal_hold_reason` で個別退避 |
| 9 | Turnstile (Phase 2/4) | フォーム保護のみ、DoS / 総当たり別途 (重要) | 多層防御 L1-L6 (Turnstile + rate limit + 認証コード送信制限 + ログイン失敗ロック + 検索 throttling + 失敗メトリクス監視) |
| 10 | outbox + polling | 責務混同 (補強) | outbox = 書き込み信頼性 / UI 更新 = `updated_at` cursor polling + TanStack Query invalidation + windowFocus refetch |
| 11 | `app/[locale]/` dir のみ | 不要な複雑化 (補強) | **dir 構造撤回**。`app/` 直下日本語単一 + `<html lang="ja">` + `lib/i18n/messages.ts` 定数化 + formatter は `companies.time_zone` / `default_currency` 経由 |

## 確定 11 件 (v2 詳細)

詳細は `requirements.md` §33 v2 を参照。本ドラフトは経緯記録。

### 1. 顧客 SMS 認証 → email のみ (🏢 顧客層 email リテラシー次第)
### 2. 業者 SLA → 種別基準 + テナント境界保証 override (vendor_sla_overrides 正版)
### 3. 自動マッチング → 推奨マーク + 内訳保存 + selection log
### 4. 業者見積・請求 → 月次 CSV + 金額カラム分割先取り (🏢 経理連携 MVP 必須か)
### 5. 月表示カレンダー → Phase 3 末 (§28.1 整合済み)
### 6. 表示項目設定 → MVP 固定列、Phase 5 で user_table_view_settings 新設
### 7. 全文検索 → partial GIN + phone_normalized + 検索ログ PII 除外
### 8. PII 匿名化 → 30 日 cron + 匿名化キー証跡 (🏢 5 年保持要請対応)
### 9. bot/DoS → 多層防御 (L1 Turnstile + L2-L6 rate limit / lock / throttling / monitoring)
### 10. Supabase Realtime → MVP 不採用 (outbox と UI polling 分離)
### 11. 多言語対応 → スコープ外、locale dir 撤回 (🏢 インバウンド需要層 MVP 含むか)

## 経営層フィードバック待ち (🏢 4 件)

#1 SMS / #4 経理連携 / #8 5 年保持 / #11 多言語 — 営業 PoC 後再評価

## 反映状況

- [x] `requirements.md` §33 v2 確定 (Task #2 完了)
- [x] `requirements.md` §28.1 矛盾解消 (Task #1 完了)
- [x] `implementation-plan.md` §16 v2 確定 (Task #3 完了)
- [x] `data-model.md` v2.2 スキーマ追加 (Task #4 完了)
  - §7.5b vendor_sla_overrides 新規
  - §6.6.1 phone_normalized + 3 テーブル partial GIN index
  - §11.2 ADR-0009 補強 (検索ログ PII 除外)
  - §11.2b pii_anonymization_jobs 新規 + v_accounting_audit_trail view
- [x] このドラフト v2 化 (Task #5 完了)

## 次セッションへの引き継ぎ

Phase 2 着手前に経営層フィードバック (🏢 4 件) を取得 → §33 残置項目を最終確定 → Phase 0 PoC へ。

Phase 0 PoC は `implementation-plan.md` §3 Phase 0 で 11 項目。要件確定後すぐ着手可能。

## 参照

- `codex-review-decisions-2026-05-23.md` — Codex 第二意見原文 (致命 1 + 重要 8 + 補強 2)
- `phase-handoff/phase-1.md` — Phase 1 sealed handoff
- `spec/CLAUDE.md` — プロジェクト全体概要

---

*v1: 2026-05-23 Claude 単独推奨案*
*v2: 2026-05-23 Codex 第二意見反映確定版*
