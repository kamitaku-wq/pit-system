## 致命的問題あり

### Item 1: Customer SMS auth -> email-only adopted
**指摘**: email のみに寄せる判断は、顧客予約フローとは整合するが、同一 IP / email / 電話番号のレート制限要件を本人確認強度の代替として扱っていない。電話番号は入力必須寄りの業務情報として残る一方、`verified_phone=false` のまま運用されるため、電話番号をキーにした重複・なりすまし抑止は弱い。営業面でも「高齢顧客の email リテラシー」はドラフト自身がリスクとして認めており、MVP の顧客予約を Phase 4 に含める前提では、email 不達時の店舗代行フローが未定義。
**代替案**: MVP は email 認証を主系に維持しつつ、SMS 認証の採否とは別に「店舗スタッフによる電話確認済みフラグ」「email 不達時の予約保留 / 手動確定」「同一電話番号の短時間予約制限」を Phase 4 の受入条件に追加する。
**影響度**: 重要

### Item 2: Vendor SLA -> type-based + vendor_sla_overrides table
**指摘**: `vendor_sla_overrides(vendor_id, work_category_id, sla_minutes)` は、data-model.md の「全テーブルに `company_id NOT NULL`」方針と ADR-0001 相当のテナント境界に反する形で提示されている。さらに SLA が「土日不可」「24/7 即応」を根拠にしているのに、数値の `sla_minutes` だけでは曜日・営業時間・対象店舗・レッカー要否を表せず、既存の `vendor_available_days` / `vendor_available_stores` と意味が分裂する。
**代替案**: `vendor_sla_overrides` は `company_id NOT NULL`, `vendor_id`, `work_category_id`, `sla_minutes`, `effective_from`, `effective_until`, `is_active` を持たせ、UNIQUE は `(company_id, vendor_id, work_category_id)` にする。休日・対応不可は SLA ではなく既存の availability マスターで判定し、SLA は「応答期限」だけに限定する。
**影響度**: 致命

### Item 3: Auto-matching -> manual + recommendation marks
**指摘**: 直近 30 日応答率ソートは、`vendor_response_kpi_daily` と整合するが、MVP 初期はログが少なく、未登録業者招待・スポット業者・新規業者を不利にするコールドスタートが発生する。さらに `◎/○/△` は根拠が画面上で曖昧になりやすく、業者選定ミス時の説明責任や監査証跡に弱い（推測）。
**代替案**: 推奨マークは「対応店舗 / 対応曜日 / 走行不可対応 / 直近応答率 / 直近対応不可率」の内訳を保存・表示し、選択時に `transport_order_change_logs` または専用 selection log に選定理由スナップショットを残す。
**影響度**: 重要

### Item 4: Billing Phase 5 -> monthly CSV only
**指摘**: 月次 CSV までという範囲は、`estimated_amount_minor` / `billed_amount_minor` / `currency` / `tax_included` とは接続するが、請求ステータス、承認履歴、税率、締め日、支払先、CSV 出力履歴が未定義。CSV は経理連携の最低限にはなる一方、電子帳簿保存法・インボイス制度対応の要否は未確認で、Phase 5 実装時にデータモデル再設計が必要になるリスクがある（推測）。
**代替案**: Phase 5 の実装対象は CSV に限定してよいが、Phase 1-2 の時点で金額カラムの意味を「概算 / 確定 / 税込 / 税率」に分けるか、少なくとも `billing_status` と承認監査ログの追加余地を TODO に明記する。
**影響度**: 重要

### Item 5: Calendar view -> Phase 3 end
**指摘**: ドラフトは Phase 3 末を推奨しているが、仕様内で Phase 3 と Phase 4 が併存しており、実装順序と営業資料の説明が割れる。
**代替案**: Phase 3 末に確定するなら、Phase 4 の `4.10 月表示カレンダー` を Phase 3 に移動し、requirements.md §28.1 の「Phase 4 へ後ろ倒し可」を削るか「営業 PoC 後に Phase 4 へ延期可」に変更する。
**影響度**: 重要

### Item 6: Display columns -> fixed columns + JSONB extension slots
**指摘**: `store_settings.display_columns_json` を先に用意する案は、data-model.md に `store_settings` テーブルが存在せず、現行の設定テーブルは `reservation_settings` のみであるため、そのまま反映すると新規テーブル設計が宙に浮く。
**代替案**: MVP は固定列のみとし、DB には空 JSONB を作らない。Phase 5 着手時に `user_table_view_settings(company_id, user_id, table_key, columns_json, sort_json, filter_json)` のようにユーザー単位で追加する。
**影響度**: 重要

### Item 7: Full-text search -> 3-table GIN index
**指摘**: `customers` の氏名 / フリガナ / 電話、`vehicles` の車台番号 / ナンバー、`service_tickets` の要望文 / 完了報告は PII または準 PII を含む。匿名化 cron 前の soft delete 30 日間、検索インデックスには PII が残る。
**代替案**: インデックスは `WHERE deleted_at IS NULL` の partial index を基本にし、顧客検索は電話番号の正規化カラムを別途用意する。検索 API は必ず company_id と権限スコープを先に絞り、検索ログにも PII を残さない方針を ADR-0009 に追記する。
**影響度**: 重要

### Item 8: PII anonymization -> 30-day cron
**指摘**: 30 日匿名化は requirements.md §19.2 と整合するが、ドラフトの「経理証跡で顧客名を 5 年保持する監査用ビュー」は、テーブル本体を匿名化する方針と矛盾する。ビューは元データが消えれば保持できないため、実際には別テーブルや外部保管が必要になる。
**代替案**: `pii_anonymization_jobs` に `requested_at`, `verified_at`, `scheduled_for`, `processed_at`, `status`, `failure_reason`, `legal_hold_reason` を持たせる。経理上の保持が必要な場合は、顧客名そのものではなく伝票番号・車両 ID・金額・匿名化済み顧客キーで証跡を残す方針を原則にする。
**影響度**: 重要

### Item 9: Bot protection -> Cloudflare Turnstile
**指摘**: Turnstile 採用自体は公開フォーム対策として妥当だが、対象が Phase 2 業者ポータルログインと Phase 4 顧客予約フォームだけでは、認証コード送信 DoS、Resend コスト増、業者ログイン総当たり、予約枠探索の高頻度アクセスを防げない。
**代替案**: Turnstile は「フォーム送信前の追加シグナル」と位置付け、IP / email / phone / vendor_user_id 単位の rate limit、認証コード送信回数制限、ログイン失敗ロック、予約枠検索 API のスロットリング、失敗メトリクス監視を追加する。
**影響度**: 重要

### Item 10: Supabase Realtime -> not adopted in MVP
**指摘**: Realtime 不採用はコスト面では理解できるが、代替として `notification_outbox + 30 秒 polling` と書くのは責務が混ざっている。outbox は配送信頼性のための書き込み・再送基盤であり、UI の最新状態取得とは別問題。
**代替案**: MVP は Realtime 不採用でよいが、UI 更新は outbox ではなく `updated_at` / cursor ベースの軽量 polling API と TanStack Query の invalidation で設計する。
**影響度**: 補強

### Item 11: Multilingual -> out of scope (dir attribute only)
**指摘**: 多言語をスコープ外にする一方で `next-intl` の `app/[locale]/` 構造だけ先に入れる案は、JST / JPY 固定、国内中古車販売会社向けという現行要件に対して初期ルーティング・middleware・リンク生成・SEO・認可 callback URL を複雑化する。
**代替案**: MVP は `app/` 直下の日本語単一構成にし、HTML の `lang="ja"` と必要箇所の `dir` だけ設定する。将来の多言語化に備えるなら、UI 文言を定数化し、日時・通貨 formatter を `companies.time_zone` / `default_currency` 経由にしておく程度に留める。
**影響度**: 補強
