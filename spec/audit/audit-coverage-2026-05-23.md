# spec 網羅性監査 v1 (2026-05-23)

## メタ

| 項目 | 値 |
|---|---|
| 監査対象 | 11 ファイル / 約 7,000 行（claude-design-handoff.md・screen-list.md・roadmap/* 含む） |
| 実施 | Claude (Lane Main) — Codex sandbox 書込ブロックにより Claude が引き取り |
| 実施日 | 2026-05-23 |
| 判定基準 | 致命 (Critical = MVP-α 5/31 達成不可) / 重要 (High = Phase 2 縦切り欠陥) / 補強 (Medium) / 情報 (Low) |

---

## A. Phase 0 PoC 16 項目チェック

> implementation-plan.md §3 Phase 0 は 16 項目 (0.1〜0.16) を定義。
> ロードマップ Sprint α-0 の「11 タスク」は Main/A/B 役割別列挙で、項目番号とは別体系。

| # | PoC 項目 | data-model.md | verification-checklist §Phase0 | roadmap α-0 | 影響度 |
|---|---|---|---|---|---|
| 0.1 | リポジトリ初期化 / CI / Drizzle / Supabase ローカル | — (インフラ) | ✗ 未記載 | ✗ 未記載 | Low |
| 0.2 | companies / users / vendor_users 最小スキーマ + RLS | ✓ 3 テーブル定義済 | ✓ 最小スキーマ動作 | ✓ RLS 漏洩 PoC | OK |
| 0.3 | RLS 漏洩テスト (会社間・業者間・顧客) | ✓ RLS policy 全テーブル | ✓ 3 パターン明記 | ✓ Main タスク | OK |
| 0.4 | reservations 最小スキーマ + exclusion constraint | ✓ tstzrange + exclusion | ✓ 並列予約確定 | ✓ Main タスク | OK |
| 0.5 | 並列予約確定テスト (50 並列) | ✓ exclusion 設計 | ✓ 50 並列 INSERT | ✓ Main タスク | OK |
| 0.6 | notification_outbox + Inngest 配送 | ✓ outbox テーブル | ✓ Inngest 配送・retry | ✓ Main タスク | OK |
| 0.7 | TX + outbox + Inngest retry テスト | ✓ outbox retry 設計 | ✓ idempotency_key | ✓ Main タスク | OK |
| 0.8 | 業者ポータル権限モデル PoC | ✓ vendor_users + RLS | ✓ 業者ポータル権限 | ✓ Lane A タスク | OK |
| 0.9 | Vercel runtime PoC | — (インフラ) | ✓ Vercel runtime | ✓ (impl-plan §2 参照) | Low |
| 0.10 | 監査ログトリガ PoC | ✓ audit_logs + trigger | ✓ 監査ログ | ✗ α-0 タスク表に明示なし | Medium |
| 0.11 | TZ 動作テスト (UTC/JST) | ✓ UTC 保存方針 §1 | ✓ TZ | ✗ α-0 タスク表に明示なし | Medium |
| 0.12 | マイグレーション順序検証 (v2.1) | ✓ §17 順序定義 | ✓ v2.1 追加済 | ✗ α-0 タスク表に明示なし | Medium |
| 0.13 | outbox FOR UPDATE SKIP LOCKED (v2.1) | ✓ §6 dispatcher 設計 | ✓ v2.1 追加済 | ✓ Main outbox retry PoC | OK |
| 0.14 | 楽観排他テスト (v2.1) | ✓ reservations.version | ✓ v2.1 追加済 | ✗ α-0 タスク表に明示なし | Medium |
| 0.15 | 案件単位招待先着受注 (v2.1) | ✓ transport_order_invitations.is_winning_bid | ✓ v2.1 追加済 | ✗ α-0 タスク表に明示なし | Medium |
| 0.16 | PII redaction (v2.1) | ✓ audit_logs PII マスク方針 | ✓ v2.1 追加済 | ✗ α-0 タスク表に明示なし | Medium |

### 欠落項目サマリ (6 件)

0.10 / 0.11 / 0.12 / 0.14 / 0.15 / 0.16 の 6 項目が **roadmap.md Sprint α-0 タスク表に未記載**。
verification-checklist §Phase0 v2.1 に受入基準が存在するため品質リスクは低いが、DoD 突合が困難。

**推奨**: roadmap.md Sprint α-0 タスク表に「v2.1 PoC 補完 6 項目（0.10〜0.12 / 0.14〜0.16）」を Main Lane 補完タスクとして追記。

---

## B. MVP-α 5/31 必達スコープ過不足

### B.1 欠落要素 (5/31 までに必要だが Sprint α タスク表に不在または不明確)

| # | 欠落 / 不明確要素 | 参照要件 | 影響度 |
|---|---|---|---|
| B-1 | service_tickets + vehicles CRUD が Sprint α-1/2 タスク表に不在 | verification-checklist §Phase2 整備伝票作成・車両情報作成 | **Critical** |
| B-2 | reservation 作成 UI (予約枠設定後の予約作成フロー) が Sprint α タスク未記載 | requirements.md §15 予約作成フロー | **Critical** |
| B-3 | 移動パターン 4 種 (pickup_only / deliver_only / round_trip / direct_transfer) 全パス検証が Sprint α 未記載 | data-model.md §7.6 movement_pattern CHECK | **High** |
| B-4 | 業者対応不可フォールバック 4 パスの E2E テスト対応が明示なし (Sprint α-2 に記載はあるが完了基準のみ) | verification-checklist §Phase2 対応不可フォールバック | **High** |
| B-5 | vendor_selection_logs が Sprint α タスク表に不在かつ data-model.md 未定義 | implementation-plan §16 #3 | **High** |
| B-6 | stale outbox recovery の実装タスクが Sprint α にない (verification-checklist §Phase0 v2.1 には受入項目あり) | verification-checklist §Phase0 stale processing リカバリ | **High** |
| B-7 | vendor_sla_overrides 適用で新スキーマ (effective_from/until/is_active) 対応が Sprint α 実装タスクに不明 | data-model.md §7.5b | Medium |
| B-8 | audit_logs append-only trigger が Sprint α-2 にあるが DoD との対応未明示 | verification-checklist §Phase0 v2.1 | Medium |

### B.2 余剰要素 (Sprint α に入っているが Phase 2 縦切りに不要な要素)

| # | 余剰項目 | Sprint | 推奨 |
|---|---|---|---|
| E-1 | pii_anonymization_jobs Vercel Cron 定義 (テーブル DDL は問題なし) | α-1 Main | Cron 定義 (vercel.json) は Phase 4 まで不要。DDL のみ先行で OK |
| E-2 | FullCalendar 統合 PoC | α-0 Lane B | Phase 3 機能だが技術リスク解消の価値あり。削除非推奨 |
| E-3 | 業者向け onboarding ドキュメント作成 | α-3 Lane A | Phase 3 相当。5/31 リリース判定に必須ではない |
| E-4 | 操作マニュアル骨格作成 | α-3 Lane B | 同上 |

### B.3 Phase 2 必須テーブル × Sprint α 対応マップ

| テーブル | data-model.md | Sprint α タスク | 状況 |
|---|---|---|---|
| transport_orders | ✓ §7.6 完全定義 | α-2 Lane A | OK |
| transport_order_invitations | ✓ §7.10 完全定義 | α-2 Lane A | OK |
| vendor_users | ✓ §3.6 完全定義 | α-0 Lane A / α-1 Lane A | OK |
| vendor_portal_inbox | ✓ §8 定義あり | α-0 Lane A / α-1 Lane A | OK |
| notification_outbox | ✓ §6 完全定義 | α-0 Main / α-1 Main | OK |
| notification_deliveries | ✓ §6 定義あり | α-0 Main (Inngest) | OK |
| vendor_sla_overrides | ✓ §7.5b (v2.2) | α-1 Main / α-2 Lane A | OK (スキーマ v2.2 整合要確認) |
| pii_anonymization_jobs | ✓ §11.2b (v2.2) | α-1 Main | 余剰 (B.2 E-1 参照) |
| **vendor_selection_logs** | **✗ data-model.md 未定義** | ✗ Sprint α 未記載 | **要対応 High** |
| audit_logs | ✓ §10 完全定義 | α-0 (PoC) / α-2 Main | OK |
| transport_order_change_logs | ✓ §7.7 定義あり | — | Sprint α タスク表に明示なし |

---

## C. TODO/FIXME 残置棚卸し

### C.1 全件リスト (24 件)

| # | ファイル | キーワード | 内容抜粋 | カテゴリ | 確定済み? |
|---|---|---|---|---|---|
| C-1 | data-model.md §20 | 未確認 | 顧客の電話 SMS 認証を MVP に含めるか | 確定済み | ✗ マーカー消し漏れ |
| C-2 | data-model.md §20 | 未確認 | 業者 SLA を業者マスターか依頼種別か | 確定済み | ✗ マーカー消し漏れ |
| C-3 | data-model.md §20 | 未確認 | is_winning_bid 他招待 revoke を trigger か service か | **未確定** | ✗ 要決定 |
| C-4 | data-model.md §20 | 未確認 | 添付ファイルの保持期間 / 個人情報の保持期間ポリシー | 経営判断保留 🏢 | ✗ 未定 |
| C-5 | data-model.md §20 | 未確認 | 請求/支払いステータスを Phase 5 でどう拡張するか | 確定済み | ✗ マーカー消し漏れ |
| C-6 | data-model.md §20 | 未確認 | 全文インデックスの対象テーブル選定 | 確定済み | ✗ マーカー消し漏れ |
| C-7 | data-model.md §20 | 未確認 | vehicle_ownerships の until 自動更新ロジック | **未確定** | ✗ 実装詳細未定 |
| C-8 | data-model.md §20 | 未確認 | lane_utilization_daily の稼働可能時間計算実装版 | **未確定** | ✗ Phase 3 相当 |
| C-9 | verification-checklist §H | 未確認 | 顧客 SMS 認証を MVP に含めるか | 確定済み | ✗ マーカー消し漏れ |
| C-10 | verification-checklist §H | 未確認 | 業者 SLA を業者マスターか依頼種別か | 確定済み | ✗ マーカー消し漏れ |
| C-11 | verification-checklist §H | 未確認 | 自動マッチングレコメンドの MVP 範囲 | 確定済み | ✗ マーカー消し漏れ |
| C-12 | verification-checklist §H | 未確認 | 月表示カレンダーを Phase 3 か Phase 4 か | 確定済み | ✗ マーカー消し漏れ |
| C-13 | verification-checklist §H | 未確認 | 表示項目設定の初期実装範囲 | 確定済み | ✗ マーカー消し漏れ |
| C-14 | verification-checklist §H | 未確認 | reCAPTCHA 導入タイミング | 確定済み | ✗ マーカー消し漏れ |
| C-15 | verification-checklist §H | 未確認 | Supabase Realtime の活用範囲 | 確定済み | ✗ マーカー消し漏れ |
| C-16 | verification-checklist §H | 未確認 | 検索用全文インデックス対象 | 確定済み | ✗ マーカー消し漏れ |
| C-17 | verification-checklist §H | 未確認 | PII 匿名化の自動化スケジュール | 確定済み | ✗ マーカー消し漏れ |
| C-18 | verification-checklist §H | 未確認 | 業者の見積金額機能の実装フェーズ | 確定済み | ✗ マーカー消し漏れ |
| C-19 | verification-checklist §H | 未確認 | 多言語対応の優先度 | 確定済み | ✗ マーカー消し漏れ |
| C-20 | requirements.md §33 | 旧 v1 表現残置 | store_settings.display_columns_json JSONB 先行用意 | 確定済み (v2 で撤回) | ✗ v2 と矛盾 |
| C-21 | requirements.md §33 | 旧 v1 表現残置 | outbox + 30 秒 polling で十分 (UI 更新と責務混同) | 確定済み (v2 で分離) | ✗ v2 と矛盾 |
| C-22 | requirements.md §33 | 旧 v1 表現残置 | next-intl app/[locale]/ dir 構造のみ確保 | 確定済み (v2 で撤回) | ✗ v2 と矛盾 |
| C-23 | requirements.md §33 | 旧 v1 表現残置 | 経理証跡で顧客名 5 年保持→監査用ビュー | 確定済み (v2 で撤回) | ✗ v2 と矛盾 |
| C-24 | roadmap.md §5 | TBD | α-0 完了/残タスク数・リスク状況 | 情報 | Sprint 開始後に更新 |

### C.2 着手前確定必須項目 (Top 5)

| 優先 | 項目 | 理由 |
|---|---|---|
| 1 | C-3: winning_bid revoke を trigger か service か | Sprint α-2 の invitations revoke ロジック設計に直結。α-2 着手前に必須 |
| 2 | C-20〜23: requirements.md §33 v1 表現 4 件を v2 内容に修正 | 実装者が v1 を読んで誤実装するリスクを防ぐ。α-1 着手前に修正 |
| 3 | C-4: 添付ファイル保持期間ポリシー | storage.objects RLS と自動削除 cron 設計に影響。経営判断必要 🏢 |
| 4 | C-7: vehicle_ownerships.until 自動更新ロジック | Phase 2 所有履歴記録時のサービス層設計に影響 |
| 5 | C-1/2/9〜19: 確定済み 15 件マーカーを一括クローズ | ドキュメント信頼性低下防止 |

---

## D. Codex 第二意見反映漏れ (11 件)

| # | Codex 指摘 | 推奨案 | 反映状況 | 反映先 | 漏れ? |
|---|---|---|---|---|---|
| 1 | email のみ採用時の店舗代行フロー・なりすまし対策不足 (重要) | Phase 4 で phone_verified_at / email 不達手動確定 / 電話番号レート制限 | 部分 | impl-plan §16 に記載 / data-model.md に customers.phone_verified_at カラム定義なし | ✗ Medium |
| 2 | vendor_sla_overrides の company_id 欠落 (致命) | company_id 必須 + effective_from/until/is_active + UNIQUE(company_id,vendor_id,work_category_id) | ✓ | data-model.md §7.5b (v2.2) 完全反映 | OK |
| 3 | 推奨マーク根拠不透明・コールドスタート (重要) | 内訳カラム保存 + vendor_selection_logs で監査 | 部分 | impl-plan §16 #3 に記載 / data-model.md に vendor_selection_logs テーブル定義なし | ✗ High |
| 4 | billing_status / 承認監査ログ余地が未定義 (重要) | Phase 1-2 で金額カラム分割 + billing_status enum | 部分 | impl-plan §16 #4 に記載 / data-model.md §7.4 に quoted_amount_minor / tax_rate_bps / billing_status enum 未追加 | ✗ High |
| 5 | Phase 3/4 の §28.1 矛盾解消 (重要) | Phase 3 末確定 + §28.1 修正 | ✓ | requirements.md §28.1 修正済み | OK |
| 6 | store_settings テーブル不在で JSONB 先行が宙に浮く (重要) | MVP 固定列のみ、JSONB 用意撤回 | ✗ | requirements.md §33 に store_settings.display_columns_json v1 記述残存 | ✗ High |
| 7 | partial GIN + phone_normalized + 検索ログ PII 除外 (重要) | partial index + GENERATED + ADR-0009 補強 | ✓ | data-model.md §6.6.1 (v2.2) 完全反映 | OK |
| 8 | 監査用ビュー 5 年保持が匿名化と矛盾 (重要) | pii_anonymization_jobs に legal_hold_reason + 匿名化キー証跡 | 部分 | data-model.md §11.2b 完全反映 / requirements.md §33 に「監査用ビュー」旧記述残存 | ✗ Medium |
| 9 | Turnstile のみでは DoS/総当たり防御不足 (重要) | L1-L6 多層防御 (Turnstile + rate limit + ログイン失敗ロック等) | 部分 | impl-plan §16 #9 に記載 / requirements.md §33 に「Turnstile を Phase2/4 のみ」旧記述残存 | ✗ Medium |
| 10 | outbox と UI polling の責務混同 (補強) | outbox=書込信頼性 / UI=cursor polling + TanStack Query | ✓ | impl-plan §16 #10 に反映 / requirements.md §33 に「outbox + 30 秒 polling で十分」旧記述残存 | ✗ Medium |
| 11 | app/[locale]/ dir が不要な複雑化 (補強) | app/ 直下単一構成 + html lang=ja | 部分 | impl-plan §16 #11 に反映 / requirements.md §33 に「next-intl app/[locale]/」旧記述残存 | ✗ Medium |

### 反映漏れサマリ (7 件)

| 影響度 | 内容 |
|---|---|
| **High** | D-3: vendor_selection_logs テーブルが data-model.md に未定義 |
| **High** | D-4: quoted_amount_minor / tax_rate_bps / billing_status enum が data-model.md §7.4 未追加 |
| **High** | D-6: requirements.md §33 に store_settings.display_columns_json v1 記述が残存 |
| **Medium** | D-1: customers.phone_verified_at が data-model.md 未定義 |
| **Medium** | D-8: requirements.md §33 に「監査用ビュー 5 年保持」旧記述残存 |
| **Medium** | D-9: requirements.md §33 に「Turnstile のみ」旧記述残存 |
| **Medium** | D-10/11: requirements.md §33 に「outbox+30 秒 polling」「next-intl app/[locale]/」旧記述残存 |

---

## E. 総評

| 判定 | 件数 | 主要項目 |
|---|---|---|
| **Critical** | 2 件 | B-1 (service_tickets/vehicles CRUD が Sprint α 未記載) / B-2 (reservation 作成 UI が Sprint α 未記載) |
| **High** | 6 件 | B-3/4/5/6 / D-3 (vendor_selection_logs 未定義) / D-4 (billing_status 等未追加) |
| **Medium** | 9 件 | A: roadmap α-0 タスク表 6 項目不足 / C-3/4/7 未確定 / D-1/6/8〜11 反映漏れ |
| **Low** | 2 件 | A-0.1/0.9 verification-checklist 未記載 (実害なし) |

### MVP-α 5/31 リリース可能性: **3 / 5**

Critical 2 件 (B-1/B-2) を解消しないと Sprint α-2「業者ループ縦切り」が整備伝票・車両・予約作成なしで完了し、
Sprint α-3 の E2E テストが通らないリスクが高い。Critical を先に潰せば **4/5** まで改善見込み。

### 修正推奨優先順位 Top 5

| 優先 | 作業 | 対象ファイル | 工数目安 |
|---|---|---|---|
| 1 | Sprint α-2 タスク表に service_tickets CRUD / vehicles CRUD / reservation 作成 UI を追加 (B-1/B-2) | roadmap.md | 30 分 |
| 2 | vendor_selection_logs テーブル定義を data-model.md に追加 (D-3) | data-model.md | 1 時間 |
| 3 | data-model.md §7.4 service_tickets に quoted_amount_minor / tax_rate_bps / billing_status enum を追加 (D-4) | data-model.md | 30 分 |
| 4 | requirements.md §33 を v2 版に更新 — v1 と矛盾する 4 箇所を v2 決定内容に書き換え (C-20〜23 / D-6/8〜11) | requirements.md | 45 分 |
| 5 | data-model.md §20 / verification-checklist §H の確定済み 15 件チェックボックスをクローズ (C-1〜19) | 各ファイル | 20 分 |

---

*監査実施: 2026-05-23 / 次回更新推奨: Sprint α-1 末 (2026-05-27)*
## E. 総評

| 判定 | 件数 | 主要項目 |
|---|---|---|
| **Critical** | 2 件 | B-1 (service_tickets/vehicles CRUD が Sprint α 未記載) / B-2 (reservation 作成 UI が Sprint α 未記載) |
| **High** | 6 件 | B-3/4/5/6 / D-3 (vendor_selection_logs 未定義) / D-4 (billing_status 等未追加) |
| **Medium** | 9 件 | A: roadmap α-0 タスク表 6 項目不足 / C-3/4/7 未確定 / D-1/6/8〜11 反映漏れ |
| **Low** | 2 件 | A-0.1/0.9 verification-checklist 未記載 (実害なし) |

### MVP-α 5/31 リリース可能性: **3 / 5**

Critical 2 件 (B-1/B-2) を解消しないと Sprint α-2 業者ループ縦切りが整備伝票・車両・予約作成なしで完了し、
Sprint α-3 の E2E テストが通らないリスクが高い。Critical を先に潰せば **4/5** まで改善見込み。

### 修正推奨優先順位 Top 5

| 優先 | 作業 | 対象ファイル | 工数目安 |
|---|---|---|---|
| 1 | Sprint α-2 タスク表に service_tickets CRUD / vehicles CRUD / reservation 作成 UI を追加 (B-1/B-2) | roadmap.md | 30 分 |
| 2 | vendor_selection_logs テーブル定義を data-model.md に追加 (D-3) | data-model.md | 1 時間 |
| 3 | data-model.md §7.4 service_tickets に quoted_amount_minor / tax_rate_bps / billing_status enum を追加 (D-4) | data-model.md | 30 分 |
| 4 | requirements.md §33 を v2 版に更新 - v1 と矛盾する 4 箇所を v2 決定内容に書き換え (C-20 to 23 / D-6/8 to 11) | requirements.md | 45 分 |
| 5 | data-model.md §20 / verification-checklist §H の確定済み 15 件チェックボックスをクローズ (C-1 to 19) | 各ファイル | 20 分 |

---

*監査実施: 2026-05-23 / 次回更新推奨: Sprint α-1 末 (2026-05-27)*
