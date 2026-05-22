# 整備ピット予約・店間整備・業者通知システム 要件定義書（改訂版 v2.2）

> 改訂日: 2026-05-22
> v2 → v2.1: Codex 第二意見 + 5 設計判断 + Codex v2 総合レビュー 19 指摘 + 3 追加判断（MVP / 招待 / 楽観排他）反映。
> **v2.1 → v2.2: Codex 最終レビュー反映**。業者責任分界・承諾証跡・免責文言、未登録業者招待、通知失敗アラート、LINE/SMS の Phase 整理。

## 0. このファイルの目的

このドキュメントは、Claude Code で計画・実装に入るための **要件定義の最終形** です。

### 0.1 厳守事項

- 会話で出た機能・仕様・要件を勝手に削除しない
- 会話で出た機能・仕様・要件を勝手に別仕様へ編集しない
- 実装時に不明点がある場合は、仕様を削るのではなく、未確定事項として扱う
- MVP として優先順位を付ける場合でも、将来要件として残す
- 画面はシンプルにする
- 今後拡張しやすい設計にする
- 各種設定はできるだけ設定画面・マスターから変更できるようにする
- **既存要件 v1 で言及した項目は v2 でも全て残す（削除ゼロ）**

### 0.2 関連ドキュメント

- `data-model.md` v2.1 — DB スキーマ / RLS / インデックス / マイグレーション順序
- `implementation-plan.md` v2.1 — Phase 構成 / PoC / 工数感
- `screen-list.md` v2.1 — 画面一覧
- `verification-checklist.md` v2.1 — 受入テスト

### 0.3 MVP の定義（v2.1 で明確化）

- **MVP = Phase 0 ～ Phase 4 全体**
- **MVP コア = Phase 2（店間整備 + 店間移動 + 業者通知ループ）**
- Phase 0 PoC を Phase 0 として MVP の前段に位置付け
- 顧客予約は Phase 4 で MVP の最終段として実装、業者通知ループ安定後にリリース

---

# 1. 重要決定事項（v2 + v2.1 で確定）

## 1.1 設計判断（v2 5 項目 + v2.1 3 項目）

| 項目 | 確定内容 |
|---|---|
| テナント単位 | **販売会社（法人）単位**。`companies` を最上位、**全テーブル** に `company_id`（中間 / 履歴 / 通知 / 監査含む） |
| 業者 ⇔ 会社 | **デフォルト専属 + 将来共有可**。`vendors.company_id` 必須 + `vendor_company_memberships` |
| 業者対応可後 | **依頼種別で切替、デフォルト自動確定**。`transport_orders.confirmation_mode` enum |
| 店間移動パターン | **片道 / 往復 / 引取のみ / 三点移動** 全対応 + **DB CHECK で整合保証** |
| 顧客予約 | **MVP に含める**（Phase 4）。本人確認 + 予約変更/キャンセルトークン込み |
| **MVP 定義（v2.1）** | **Phase 0-4 全体 = MVP、Phase 2 = MVP コア**。業者通知ループを縦切りで最優先 |
| **案件単位招待（v2.1）** | **MVP に含める**。`transport_order_invitations` で複数業者打診・スポット業者対応 |
| **同時編集競合（v2.1）** | **楽観排他**（`version` カラム + IF MATCH UPDATE）。重要テーブルに適用 |

## 1.2 技術スタック

| 領域 | 確定 |
|---|---|
| FW | Next.js (App Router) + TypeScript（Node.js runtime 固定） |
| DB | PostgreSQL（Supabase, ap-northeast-1 Tokyo） |
| ORM | Drizzle |
| 認証 | Supabase Auth（社内・業者のみ、顧客は除外） |
| 認可 | 自前 DB membership + RLS helper function |
| 顧客本人確認 | `customer_reservation_tokens` テーブル + 署名トークン |
| Mail | Resend + React Email |
| Jobs | Inngest（通知 outbox の配送 worker）+ Vercel Cron |
| 通知 | DB outbox 必須、`idempotency_key UNIQUE` |
| 予約排他 | exclusion constraint + tstzrange + gist（DB レベル） |
| TX 境界 | service 関数 + `drizzle.transaction()`（Server Actions は薄い層） |
| 履歴 | `*_status_history` append-only |
| TZ | UTC 保存 / JST 表示固定 |
| UI | shadcn/ui + Tailwind + FullCalendar |

## 1.3 MVP 着手前に必須の PoC（5 項目）

機能実装に入る前に、技術リスクを潰すための PoC を Phase 0 で実施:

1. **RLS 漏洩テスト** — 会社 A/B、専属業者、共有業者、顧客トークンで他社 row が 0 件
2. **並列予約確定テスト** — 同一 lane / 時間帯に 50 並列 → 1 件成功 / 残りエラー
3. **TX + outbox + Inngest retry** — Inngest 落としても outbox が残り、復旧後に 1 度だけ送信
4. **業者ポータル権限モデル** — 専属/共有/案件単位招待を RLS で表現
5. **Vercel runtime** — Node.js runtime 固定 + Supabase pooler で接続数破綻なし

---

# 2. システム概要

中古車販売店・自動車販売会社（販売会社単位 SaaS）向けに、整備ピットの空き状況を複数店舗間で共有し、顧客の来店予約、店間整備予約、整備伝票ごとの車両管理、店間移動が発生した場合の回送・陸送業者への通知まで一元管理できるシステム。

多店舗展開している会社では、整備ピットを持っている店舗と、持っていない店舗が混在する。整備ピットがない店舗でも、他店舗のピット空き状況を確認し、整備予約を入れられるようにする。

店間整備予約によって車両の店間移動が発生した場合は、あらかじめマスターに登録してある回送・陸送業者へ、メール通知と業者用マイページ通知が **DB outbox 経由で確実に** 自動送信される仕組みにする。

---

# 3. システムの目的

- 整備ピットの空き状況を全店舗で共有する
- 顧客が来店整備予約をできるようにする
- 店舗スタッフが店間整備予約を入れられるようにする
- 整備ピットがない店舗から、整備ピットがある店舗へ作業依頼できるようにする
- 車両を整備伝票ごとに管理する
- 作業メニューを選ぶと、自動で必要な予約枠が埋まるようにする
- 店間移動が発生した場合、登録済み業者へメールとマイページ通知を送る
- 業者がマイページで依頼確認・対応可否・進捗更新できるようにする
- 店舗側が業者の確認状況・対応可否・進捗を確認できるようにする
- 全ての運用ルールを設定画面から変更できるようにする
- **販売会社単位の SaaS マルチテナント** として、テナント境界が DB レベルで強制される
- 将来的に LINE 通知、請求管理、納車前管理、OCR、在庫管理、自社ローン管理などへ拡張しやすくする

---

# 4. 利用者

## 4.1 本部管理者（headquarters_admin）
販売会社全体・全店舗・全設定を管理できるユーザー。

できること：
- 全店舗のピット空き状況確認
- 全店舗の予約確認
- 店舗設定
- レーン設定
- 作業メニュー設定
- ステータス設定
- 状態遷移ルール設定
- 回送・陸送業者マスター管理
- 権限管理
- 通知設定
- 稼働率や予約状況の確認
- 監査ログ閲覧

## 4.2 店長（store_manager）
店舗単位の責任者。

できること：
- 自店舗の予約管理（権限上書き含む）
- 自店舗のレーン稼働時間設定
- 自店舗の店間整備依頼の確定承認（confirmation_mode=manual 時）
- 自店舗スタッフの操作確認

## 4.3 工場長（factory_lead）
整備工場の責任者。

できること：
- レーン稼働状況管理
- 作業スケジュール管理
- 整備士の作業負荷確認

## 4.4 店舗スタッフ（store_staff）
各店舗で予約や車両管理を行うユーザー。

できること：
- 自店舗の予約確認
- 顧客予約登録
- 店間整備予約登録
- 整備伝票情報入力
- 車両情報入力
- 店間移動の有無を設定
- 回送・陸送業者の選択
- ステータス更新
- 業者の対応状況確認

## 4.5 工場・整備担当者
整備作業を担当するユーザー。

できること：
- ピット予約確認
- 作業内容確認
- レーン別スケジュール確認
- 作業開始・完了ステータス更新
- 重整備内容確認
- 作業時間調整（actual_in/out 入力）

## 4.6 回送・陸送業者ユーザー（vendor_user）
業者ポータルにログインする外部アカウント（`vendor_users` テーブル管理）。社内ユーザーとは認証基盤上完全に分離。

できること：
- 自社宛の新規依頼確認（他業者・他社案件は RLS で遮断）
- 依頼詳細確認
- 対応可否回答
- 引取予定日時の入力
- 搬入予定日時の入力
- 返却予定日時の入力
- 引取完了報告
- 搬入完了報告
- 返却完了報告
- 備考入力

## 4.7 顧客
来店予約をする一般ユーザー。**Supabase Auth user にはしない**（MAU 課金回避 + シンプル化）。

できること：
- 店舗選択
- 作業メニュー選択
- 空き日時確認
- 来店予約（email 認証コードで本人確認）
- 予約内容確認（署名トークン付き URL 経由）
- 予約変更（modify トークン）
- キャンセル（cancel トークン）

---

# 5. テナント・認可モデル

## 5.1 テナント階層

```
companies (販売会社)
  ├─ users (社内ユーザー = 店舗スタッフ・本部管理者・工場長)
  ├─ stores (店舗)
  │   ├─ lanes (レーン)
  │   └─ store_business_hours / store_holidays
  ├─ vendors (業者マスター、デフォルト company_id 専属)
  │   └─ vendor_users (業者ログインアカウント)
  ├─ customers (顧客)
  │   └─ customer_reservation_tokens (本人確認トークン)
  └─ service_tickets / reservations / transport_orders ...
```

## 5.2 業者の専属 / 共有

- **専属（デフォルト）**: `vendors.company_id` が単一会社固定。他社からは見えない
- **共有（将来）**: `vendors.is_shared = true` で `vendor_company_memberships` 経由で複数会社から利用可
- MVP は専属のみ実装、共有テーブルは構造だけ用意

## 5.3 RLS で強制すること

| ロール | アクセス可能範囲 |
|---|---|
| 社内ユーザー | 自社 (`company_id = current_user_company_id()`) のみ |
| 業者ユーザー | `vendor_id = current_vendor_id()` かつ自社 or memberships で許可された会社のみ |
| 顧客 | Supabase Auth に存在しない、token hash 経由でのみ自分の予約を参照 |

`service_role` は migration / Inngest worker / 監査機能の限定用途のみ。

---

# 6. 必須機能

## 6.1 ピット空き状況共有

各店舗の整備ピット空き状況を、全店舗（同一会社内）から確認できるようにする。カレンダー形式で店舗・レーン・日付ごとに表示。

表示項目：
- 店舗名、レーン名、レーン種別
- 空き時間、予約済み時間
- 作業内容、車両情報、整備伝票番号
- ステータス、担当者、店間移動有無、業者手配状況

---

# 7. レーン管理

整備ピットは、単純な台数管理ではなく、レーン種別ごとに管理する。

初期レーン種別（`lane_types`）:
- メンテナンス専用レーン（オイル交換、点検、タイヤ交換）
- 重整備専用レーン（車検整備、故障診断、エンジン系、足回り）
- 汎用レーン（設定で両用）

将来追加：車検専用、診断専用、納車前整備専用、外注作業用。

## 7.1 レーン設定項目

設定画面から変更可：
- 店舗、レーン名、レーン種別、同時予約可能数、表示順、使用可否、備考
- 対応可能作業メニュー（`lane_work_menus` で M2M）
- 稼働曜日・時間（`lane_working_hours`）

---

# 8. 作業メニュー管理

作業内容はプルダウン選択。メニューごとに標準作業時間・使用レーン種別・バッファ時間を設定し、選択するだけで必要な予約枠が自動確保される。

## 8.1 作業メニュー例
- オイル交換、タイヤ交換、12ヶ月点検、車検整備
- 故障診断、エンジン異音診断、足回り修理、電装系修理
- その他重整備

## 8.2 設定項目（設定画面）
- 作業カテゴリ、作業メニュー名
- 標準作業時間、使用レーン種別、必要予約枠数、バッファ時間
- 顧客予約に表示するか / 店舗側予約に表示するか / 店間整備予約に表示するか
- フリー入力許可
- 使用可否、表示順、備考

---

# 9. 重整備のフリー入力対応

重整備は内容が毎回異なるため、プルダウンに加えて自由入力可（`allows_free_input = true` のメニュー）。

入力項目：
- 作業内容詳細、想定作業時間、使用レーン
- 注意事項、必要部品、整備士への申し送り

---

# 10. 予約枠の自動確保 + 排他制御

## 10.1 自動確保フロー

1. 作業メニュー選択
2. 必要レーン種別を自動判定
3. 標準作業時間 + バッファ時間を自動反映
4. 空いているレーン・時間を検索
5. 予約日時を選択
6. 該当時間枠を予約レコード化（DB レベル排他で確定）

## 10.2 排他制御（重要）

### 10.2.1 予約枠の重複防止（DB レベル）

`reservations` テーブルに **exclusion constraint** を設定:

```sql
EXCLUDE USING gist (
  lane_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (deleted_at IS NULL AND is_double_booking = false AND lane_id IS NOT NULL)
```

- 同じレーンの時間重複は DB が拒否
- `is_double_booking = true`（店長権限上書き）は制約から除外
- アプリ側の「find then insert」は禁止、`drizzle.transaction()` 内で実行

### 10.2.2 同時編集の楽観排他（v2.1 追加）

複数スタッフが同じ予約を同時編集する競合は **楽観排他** で防ぐ:

- `reservations` / `service_tickets` / `transport_orders` / `vendors` / `customers` / `vehicles` に `version int NOT NULL DEFAULT 1` カラム
- UPDATE 時は `WHERE id = ? AND version = ?` の IF MATCH + `SET version = version + 1`
- 不一致時は `OptimisticLockError` を返し、UI で「他のスタッフが更新しました、再読込してください」と表示
- 設定画面など重要度の低い画面は last-write-wins でも可（個別に明示）

## 10.3 設定画面で変更可

- 予約単位（15 / 30 / 60 分）
- 午前・午後枠、最終受付時間
- 当日予約可否、何日前から/まで予約可能
- 仮予約有効期限（`tentative_expires_at`）
- 重複予約許可（`allow_double_booking`）
- 店長権限上書き（`allow_manager_override`）

---

# 11. 整備伝票ごとの車両管理

車両は **整備伝票 (`service_tickets`)** ごとに管理し、予約・店間移動はその下にぶら下がる。`service_tickets` を業務伝票の親として一意化（v1 の循環参照を解消）。

## 11.1 整備伝票で管理する項目

- 整備伝票 ID / 番号
- 車両 ID、顧客 ID
- 受付店舗、作業店舗
- 作業カテゴリ、作業メニュー、作業内容詳細
- 予約日時（紐付け予約から）
- 入庫予定 / 入庫実績 / 出庫予定 / 出庫実績
- 作業開始実績 / 作業完了実績（KPI 用）
- 担当者、ステータス
- 見積金額 / 請求金額（最小通貨単位 bigint で保存、currency / tax_included 付き）
- 備考

## 11.2 車両情報

- 車両 ID / 管理番号
- 車種、年式、ナンバー、車台番号（VIN）
- 現在地店舗、車両ステータス、備考

## 11.3 車両所有履歴（中古車屋特有）

`vehicle_ownerships(vehicle_id, customer_id, since, until)` で 1 台が複数顧客に渡る運用に対応。過去整備履歴は `service_tickets.vehicle_id` を遡って取得可。

---

# 12. 顧客来店予約（MVP 含む）

顧客が Web から来店予約できる。顧客は Supabase Auth user にはせず、`customer_reservation_tokens` で本人確認。

## 12.1 顧客予約フロー

1. 店舗選択
2. 作業メニュー選択（`visible_to_customers = true` のメニューのみ）
3. 空き日時選択
4. 顧客情報入力（名前 / 電話 / email）
5. 車両情報入力
6. **email に認証コード（6 桁）送信**
7. 認証コード入力で予約確定
8. 予約完了通知（メール、署名 URL 付き）

## 12.2 予約変更 / キャンセル

- 予約完了メールに `modify` 用と `cancel` 用の **署名トークン URL** を載せる
- トークンは `customer_reservation_tokens` に SHA-256 hash で保存、`expires_at` で有効期限管理
- 一度使うと `used_at` が立ち、modify / cancel は同一トークン再利用不可（新トークンを再発行）

## 12.3 スパム対策

- 同一 IP / email / 電話番号からの予約レート制限
- 認証コードを通らない予約は確定しない
- 将来 reCAPTCHA / hCaptcha 追加可

## 12.4 顧客向け通知

- 予約完了通知
- 予約前日リマインド
- 予約変更通知
- キャンセル通知

すべて `notification_outbox` 経由で送信。

---

# 13. 店間整備予約

整備ピットがない店舗から、整備ピットがある店舗へ整備予約を入れられる。

## 13.1 フロー

1. 整備依頼を作成（`reservation_type = 'inter_store'`）
2. 整備伝票番号入力 → 既存伝票がなければ新規 `service_tickets` 作成
3. 車両情報入力
4. 作業内容選択
5. 空いている店舗・レーン・日時を選択
6. **店間移動の有無を選択**
7. 店間移動ありの場合、移動パターン + 業者を選択（次節）
8. 予約確定（TX 内で予約 + outbox 生成）

---

# 14. 店間移動・業者通知（最重要機能）

## 14.1 移動パターン（4 種類すべてサポート）

| パターン | 説明 |
|---|---|
| `one_way` | 片道（引取 → 搬入のみ、返却なし） |
| `round_trip` | 往復（引取 → 搬入 → 返却） |
| `pickup_only` | 引取のみ（廃車送り、ピックアップだけ） |
| `three_point` | 三点移動（引取 ≠ 搬入 ≠ 返却の 3 拠点） |

`transport_orders.movement_type` enum で表現。`pickup_store_id` / `delivery_store_id` / `return_store_id` を nullable にしてパターンで使い分け。

## 14.2 走行可否

`can_drive = false` の場合は **レッカー必須** とし、`tow_required = true` を立てる。業者通知にも明示。

## 14.3 業者通知の流れ（自動）

1. 店舗スタッフが店間移動ありの予約を作成、業者を選択
2. 予約確定時、**1 トランザクション内で** 以下を実行:
   - `reservations` に予約レコード（exclusion constraint で排他）
   - `service_tickets` 紐付け
   - `transport_orders` に依頼レコード
   - `transport_order_vendor_attempts` に試行レコード（attempt_seq=1）
   - `notification_outbox` に **idempotency_key 付き** で通知レコード
   - `transport_order_status_history` に初期状態記録
   - `audit_logs` に記録
3. Inngest が outbox を pickup → Resend でメール送信 + マイページ表示用 `notification_deliveries` 記録
4. 失敗時は `attempts++`、`next_attempt_at` を指数バックオフで再送

## 14.4 業者マスター（`vendors`）

設定画面で管理する項目：
- 業者 ID、業者名、担当者名、メール、電話
- 通知方法（email / portal / both）
- 専属会社 (`company_id`) + 共有可否 (`is_shared`)
- 対応エリア（`vendor_service_areas`）
- 対応可能店舗（`vendor_available_stores`）
- 対応可能曜日（`vendor_available_days`）
- 優先度（自動マッチング用）
- 使用可否、表示順、備考

## 14.5 業者通知に含める内容

- 依頼番号、整備伝票番号
- 引取店舗 / 搬入店舗 / 返却先店舗（パターンによっては null）
- 車両情報（車種、ナンバー、車台番号）
- 走行可否、レッカー要否
- 希望引取 / 搬入 / 返却日時
- 注意事項、担当店舗、担当者、連絡先
- マイページ確認 URL（業者ユーザー認証経由）

## 14.6 業者マイページ機能

- 自社宛の新規依頼一覧（未確認ステータス）
- 依頼詳細
- 対応可否回答
- 引取 / 搬入 / 返却予定日時の入力
- 引取 / 搬入 / 返却完了報告
- 備考入力

RLS で他社・他業者の案件は構造的に閲覧不可。

## 14.7 業者ステータス

業者側で管理するステータス（`status_type='vendor'`）:
- 未確認 / 確認済み
- 対応可 / 対応不可
- 引取予定 / 引取済み
- 搬入済み
- 返却予定 / 返却済み
- 完了
- キャンセル

## 14.8 店舗側で確認する業者状況

- 業者名、通知送信日時、業者確認日時
- 対応可否、引取 / 搬入 / 返却予定日時
- 現在ステータス、備考
- 店舗確定状況（`store_confirmed_at`）

## 14.9 案件単位招待（v2.1 新規）

単一業者を `transport_orders.vendor_id` に直接指定する以外に、**複数業者へ同時打診** や **スポット業者（普段使わない業者）への招待** を実現するため `transport_order_invitations` テーブルを使う。

### 利用シーン

| シーン | 動作 |
|---|---|
| 単一業者直接指名 | 従来通り `transport_orders.vendor_id` に業者をセット、`invitations` テーブルは未使用でも可 |
| **複数業者同時打診** | `transport_orders.vendor_id = NULL` で作成、`invitations` に複数 vendor 行を作成、先着で受注した業者を `vendor_id` にセット |
| **スポット業者（共有業者をその案件だけ）** | 専属業者でなくとも招待 token URL で `invitations` を発行、業者が受諾すれば `transport_orders.vendor_id` にセット |

### 競合解決ルール

- 複数業者が同時に「対応可」を返した場合、**先着 1 業者** の招待のみ `is_winning_bid = true` にセット（DB トリガまたは service 関数で楽観排他）
- 残りの招待は `response = 'revoked'` で自動失効、業者へキャンセル通知（outbox 経由）
- 競合検出は `transport_orders.version` を IF MATCH で更新することで担保

### 招待の取り消し

- 店舗側がキャンセル → 全 `invitations` を `response='revoked'` で失効
- 招待有効期限（`expires_at`）切れ → Cron で `response='expired'`

---

# 14.10 業者責任分界・承諾証跡（v2.2 新規）

業者と販売会社の責任境界を明確化し、トラブル発生時に追跡可能な証跡を残す。営業説明での「業者が指示に従わなかった場合の責任は？」への根拠。

## 14.10.1 業者承諾証跡

業者が「対応可」を返した際に以下を `transport_orders` と `transport_order_status_history` に記録：

- **承諾タイムスタンプ**（`vendor_response_at`）
- **承諾者**（`vendor_user_id` を `audit_logs` に記録）
- **IP アドレス + User-Agent**（監査ログ）
- **承諾時の依頼内容スナップショット**（`transport_order_change_logs` に before/after）
- **同意フラグ**（業者ポータルの対応可能ボタンに「以下の内容で対応します」のチェックボックス）

## 14.10.2 業者進捗未更新時のアラート

- 「対応可」回答後、引取予定時刻 + 3 時間経過しても `picked_up_at` が NULL → 店舗側にアラート（outbox 経由）
- 連続未更新（24 時間以上）→ 本部管理者にエスカレーション

## 14.10.3 回送依頼書 PDF への免責文言

回送依頼書（`screen-list.md` §6.2）の脚注に：

> 本依頼書は ◯◯株式会社（販売会社）と業者間の業務委託に基づき発行されています。業者は引取・搬入・返却の各段階で完了報告をマイページ または書面で行う責任があります。事故・遅延・誤搬送の責任は別途締結された業務委託契約書に従います。

文言は会社設定で編集可能（`companies.transport_disclaimer_text` 列を v2.2 で追加検討）。

## 14.10.4 誤搬送・破損対応の証跡

- 業者が「完了報告」した後でも、店舗側で「ステータス差戻し」が可能
- 差戻し時は理由必須（`transport_order_status_history.reason`）
- 差戻し後は業者へ自動通知 + 監査ログ記録
- 写真添付（`attachments`）で現場証跡を保管

---

# 15. 業者対応・店舗確定

## 15.1 確定モード

`transport_orders.confirmation_mode` で 2 モード:

| モード | 動作 |
|---|---|
| `auto`（デフォルト） | 業者が「対応可」を返した時点で自動確定。`store_confirmed_at` は業者回答時刻で自動セット |
| `manual` | 業者「対応可」後、店舗スタッフが「確定」ボタンを押すまで未確定。`store_confirmed_at` / `store_confirmed_by_user_id` を手動セット |

依頼種別 or 業者ごとにモードを切替可（将来）。MVP は会社単位設定で十分。

---

# 16. 業者対応不可時のフォールバック（重要）

業者が「対応不可」を返した場合の業務フロー:

1. `transport_orders.vendor_response = 'rejected'` 記録
2. `transport_order_vendor_attempts.response = 'rejected'` 記録
3. 店舗側に **対応不可通知**
4. 店舗スタッフがアクションを選択:
   - **次候補業者を選んで再打診**（attempt_seq++ で新 outbox 生成、idempotency_key も新規）
   - **希望日時変更して同業者へ再依頼**
   - **手動対応へ切替**（自社で対応）
   - **依頼キャンセル**（関連予約もキャンセル状態へ遷移）
5. 各アクションは `transport_order_change_logs` に記録、業者へ通知が必要なものは outbox 経由で送信

将来拡張：業者マスターの `priority` を使った **自動次候補レコメンド**、対応エリア・曜日マッチ。

---

# 17. 状態管理と遷移ルール

## 17.1 ステータス（設定画面で追加・変更可）

`statuses` テーブルで `status_type × key` で管理。初期シード値：

### 予約ステータス（status_type='reservation'）
仮予約 / 予約確定 / 入庫待ち / 入庫済み / 作業中 / 作業完了 / キャンセル

### 整備伝票ステータス（status_type='service'）
受付 / 入庫待ち / 入庫済み / 作業中 / 作業完了 / 納車完了 / キャンセル

### 店間移動ステータス（status_type='transport'）
業者通知済み / 業者確認済み / 業者対応可 / 業者対応不可 / 回送手配中 / 移動中 / 返却移動中 / 完了 / キャンセル

### 業者対応ステータス（status_type='vendor'）
未確認 / 確認済み / 対応可 / 対応不可 / 引取予定 / 引取済み / 搬入済み / 返却予定 / 返却済み / 完了 / キャンセル

## 17.2 遷移ルール（`status_transitions`）

- 許可された遷移のみ実行可
- DB の `status_transitions` を SELECT で確認 + TypeScript map で二重ガード
- 全遷移は `*_status_history` に append-only で記録
- 「業者対応不可」からは「キャンセル」「再打診（実質新依頼）」「希望日時変更」のみ許容

## 17.3 遷移時の通知

`status_transitions.triggers_notification = true` の遷移は、通知ルール (`notification_rules`) と突き合わせて outbox 生成。

---

# 18. 通知設計（outbox 方式）

## 18.1 設計原則

1. **DB outbox 必須** — 予約確定 / 状態遷移と同一トランザクションで `notification_outbox` に insert
2. **idempotency_key UNIQUE** で恒久重複防止（Inngest の 24h idempotency に頼らない）
3. **Inngest は outbox の配送 worker 専用** — outbox の `status='pending'` を取得 → 配送 → `notification_deliveries` 記録
4. **失敗時リトライ** — `attempts` / `max_attempts` / `next_attempt_at` で指数バックオフ
5. **デッドレターキュー** — `max_attempts` 超過は `status='failed'` で運用画面に表示
6. **dispatcher のロック戦略**（v2.1 追加）— Inngest / Vercel Cron 重複起動による二重送信を防ぐため、outbox 取得は **`SELECT ... FOR UPDATE SKIP LOCKED`** で行う。詳細は `data-model.md` §8.1.1
7. **stale processing リカバリ**（v2.1 追加）— `processing_started_at < now() - interval '15 min'` の row を `status='pending'` に戻す Cron を 5 分間隔で実行
8. **portal 通知の inbox 分離**（v2.1 追加）— 業者マイページの未読/既読は `vendor_portal_inbox` 専用テーブル、`notification_deliveries` は配送ログ専用
9. **service_role の使い分け**（v2.1 追加）— Inngest worker は service_role で全テナント outbox を取得可、ただし冒頭で `audit_logs` に `actor_kind='system'` を記録

## 18.2 通知方法（拡張可）

- メール（Resend、MVP）
- 業者マイページ通知（DB レコード、MVP）
- LINE 通知（Phase 4）
- SMS 通知（Phase 4）
- 管理画面内通知（Phase 4）

## 18.3 通知ルール（`notification_rules`、設定画面で変更可）

- 店間移動ありで予約確定時に通知
- 仮予約時点では通知しない
- 予約確定時のみ通知
- 業者変更時に再通知
- 日時変更時に通知
- キャンセル時に通知
- 前日リマインド通知（`timing_minutes_offset = -1440`）
- 未確認の場合の再通知（`retry_after_minutes` + `max_reminders`）
- 通知方法選択（メール / マイページ / 両方）

## 18.4 通知の差分管理

予約変更時、業者へ「何が変わったか」を伝えるため `transport_order_change_logs` に before/after の JSON スナップショットを保存。outbox の payload に差分を含める。

---

# 19. 監査・コンプライアンス

## 19.1 監査ログ（`audit_logs`）

主要テーブルの全変更を append-only 記録：
- entity_type / entity_id / action（create / update / delete / restore）
- actor_user_id / actor_vendor_user_id / actor_kind
- before_json / after_json（**PII は redaction policy で自動マスク**、v2.1）
- ip_address / user_agent / created_at

### 19.1.1 PII redaction policy（v2.1 新規）

audit_logs の before/after JSON は trigger 内で `redact_audit_payload()` を通してから保存。マスク対象：

| エンティティ | カラム | マスク方法 |
|---|---|---|
| customers | phone / email | `***1234` / `u***@example.com` |
| vehicles | vin | `***LAST6` |
| vendor_users / users | email | `u***@example.com` |
| customer_reservation_tokens | token_hash | 完全削除 |

実装詳細は `data-model.md` §11.2。

### 19.1.2 append-only 保護（v2.1 新規）

`audit_logs` は `REVOKE UPDATE, DELETE FROM authenticated, anon` で改ざん防止。保持期間超過のクリーンアップは service_role + 専用 Cron。

## 19.2 個人情報の取扱

| 項目 | 方針 |
|---|---|
| 顧客電話 / メール | DB 保存、TLS 通信、メール本文には記載しない |
| 車台番号 / ナンバー | 業者通知本文に記載する（業務上必要）。ログには記載しない |
| 業者ログイン PW | Supabase Auth に委譲（ハッシュ化済み） |
| 監査ログ | 90 日以上保持、CSV エクスポート可 |
| 添付ファイル | Supabase Storage、署名 URL アクセス、保持期間は設定可（デフォルト 5 年） |
| 削除済顧客 | soft delete、30 日後に PII を匿名化（電話・メール null 化、名前はマスキング） |

## 19.3 セキュリティ要件

- HTTPS 必須
- Supabase RLS 全テーブル有効化
- `service_role` は server 側 + 限定用途のみ
- 業者ユーザー / 顧客 / 社内ユーザーで Auth 階層分離
- SPF / DKIM / DMARC 設定（Resend 経由）
- メール送信レート制御
- ログイン失敗連続回数で一時ロック（Supabase Auth 設定）

---

# 20. 設定画面

運用ルールを全て設定画面から変更可能にする。会社・店舗ごとに営業時間・レーン数・作業時間・予約ルール・業者運用が違うため、システム側に固定値を持たせない。

## 20.1 設定メニュー

- **会社設定**（時間帯・通貨・プラン）
- 店舗設定
- 店舗営業時間 / 休日設定
- レーン種別設定
- レーン設定
- レーン稼働時間設定
- 作業カテゴリ設定
- 作業メニュー設定
- 予約枠設定
- ステータス設定
- **状態遷移ルール設定**（新規）
- 回送・陸送業者マスター
- 業者対応エリア / 店舗 / 曜日設定
- 通知ルール設定
- 権限設定
- 表示項目設定
- **顧客本人確認設定**（認証コード桁数・有効期限）
- **監査ログ設定**（保持期間）

---

# 21. 店舗設定

設定項目：
- 店舗名、住所、電話番号
- 営業時間（`store_business_hours`、曜日ごと）
- 定休日（`store_holidays`、日付指定）
- ピット有無、予約受付可否
- 表示順、使用可否

---

# 22. レーン種別設定

設定画面から追加・変更可。`lane_types` テーブル。

初期値：メンテナンス、重整備、汎用
追加例：車検専用、診断専用、納車前整備専用、外注作業用

---

# 23. 予約枠設定（`reservation_settings`）

会社単位 1 行：
- 予約単位（15 / 30 / 60 分）
- 午前枠 / 午後枠 / 最終受付時間
- 当日予約可否
- 何日前から / まで予約可能
- 仮予約有効期限
- 重複予約許可
- 店長権限上書き可否

---

# 24. 権限設定

`roles` + `permissions` で `permission_key` 単位で許可/拒否。

| ロール key | 内容 |
|---|---|
| `headquarters_admin` | 全店舗・全設定を管理可 |
| `store_manager` | 自店舗の予約・一部設定を管理可 |
| `factory_lead` | レーン・作業スケジュールを管理可 |
| `store_staff` | 予約登録・確認・ステータス更新可 |
| `vendor_user` | 自社宛の依頼確認・進捗更新のみ可 |
| `customer` | 自分の予約のみ確認可（auth 不要、token 経由） |

権限例：`reservation.create` / `reservation.cancel` / `vendor.notify` / `settings.lanes.write` / `audit_logs.read` 等。

---

# 25. 通知設定

`notification_rules` で会社単位に管理。詳細は §18。

通知タイミング例：
- 顧客予約完了通知
- 予約前日リマインド
- 店間整備依頼通知
- 回送発注通知
- 業者通知
- 業者確認通知
- 回送完了通知
- 作業完了通知
- キャンセル通知

---

# 26. 画面レイアウトの希望

画面はできるだけシンプルに。現場スタッフが直感的に使えるレイアウト。

## 26.1 管理画面メニュー
- ダッシュボード
- ピット予約カレンダー
- 顧客予約一覧
- 店間整備依頼
- 業者通知・回送管理
- 整備伝票一覧
- 車両一覧
- 店舗管理
- 設定

## 26.2 UX 補強要件（v2 追加）

- **モバイル対応**（レスポンシブ + PWA 対応視野）— 現場・工場利用前提
- **印刷レイアウト** — 整備伝票・回送依頼書・店間移動指示書の紙印刷
- **検索 / フィルタ** — 整備伝票・車両・予約の検索 UI
- **CSV エクスポート** — 整備伝票・予約・通知履歴
- **業務優先一覧** — ダッシュボードに「未確認業者依頼」「対応不可」「遅延案件」を上位表示
- **リアルタイム反映** — Supabase Realtime で業者ステータス変更を即時反映（任意）

---

# 27. 予約作成画面

入力項目：

## 27.1 予約種別
- 顧客来店予約
- 店間整備予約

## 27.2 整備伝票情報
- 整備伝票番号、車両管理番号、車種、ナンバー、顧客名

## 27.3 作業内容
- 作業カテゴリ、作業メニュー、作業内容詳細、想定作業時間

## 27.4 枠設定
- 標準作業時間、バッファ時間、使用レーン、予約日時

## 27.5 店間移動設定
- **店間移動有無**
- **移動パターン**（one_way / round_trip / pickup_only / three_point、DB CHECK で整合保証）
- 引取店舗 / 搬入店舗 / 返却先店舗（パターンによる、3 拠点モードは異なる店舗必須）
- 走行可否（false 時は tow_required 自動）
- 希望引取 / 搬入 / 返却日時
- 業者選択（手動 + 将来は自動レコメンド）
- **複数業者打診の有無**（v2.1：単独業者 or 招待モード）
- 確定モード（auto / manual）

---

# 28. カレンダー画面

店舗別・レーン別に予約状況を確認。

## 28.1 表示切替
- 日表示 / 週表示 / 月表示（月表示は Phase 4 へ後ろ倒し可）
- 店舗別 / レーン別 / 作業種別

## 28.2 表示内容
- 予約時間、店舗、レーン
- 作業内容、車両名、ナンバー、整備伝票番号
- ステータス、店間移動有無、業者手配状況

実装には FullCalendar 推奨。

---

# 29. 拡張性

今後追加しやすい設計にする項目：
- LINE 予約 / SMS 通知（通知 channel 抽象化済み）
- 顧客マイページ（現状トークン経由 → 将来 Auth 化）
- 請求管理 / 売上管理（`service_tickets.billed_amount_minor` を起点に拡張）
- 整備士別作業負荷管理（`service_tickets.assigned_user_id` を起点）
- 部品発注管理 / 外注管理
- 納車前管理
- 車検証 OCR（添付画像から VIN / ナンバー / 名義抽出）
- 在庫車両管理
- 自社ローン審査管理
- ダッシュボード分析（マテリアライズドビュー）
- 外部 API 連携（Webhook）
- 多店舗展開 / SaaS 化（既に対応済み）

---

# 29.5. 分析・KPI（v2.1 追加）

ダッシュボード分析の基礎となる KPI 定義。`data-model.md` §13 のマテリアライズドビューで実装。

## 29.5.1 レーン稼働率

- **定義**: `稼働率 = 予約済み分数 / 稼働可能分数 × 100`
- **稼働可能分数**: `lane_working_hours` × 営業日数（`store_holidays` で除外）
- **対象予約**: `cancelled` ステータス以外、`deleted_at IS NULL`
- **集計単位**: 会社 × 店舗 × レーン × 日次
- **マテリアライズドビュー**: `lane_utilization_daily`
- **更新**: 日次 Cron で `REFRESH MATERIALIZED VIEW CONCURRENTLY`

## 29.5.2 業者応答 KPI

- **応答時間**: `vendor_response_at - notification_sent_at` の平均
- **対応可率**: `accepted / notified × 100`
- **対応不可率**: `rejected / notified × 100`
- **集計単位**: 会社 × 業者 × 日次
- **マテリアライズドビュー**: `vendor_response_kpi_daily`

## 29.5.3 通知配送 KPI

- **配送成功率**: `sent / (sent + failed) × 100`
- **失敗内訳**: bounced / api_error / max_attempts_exceeded
- **平均配送遅延**: outbox insert → sent_at の差分

これらは Phase 3 のダッシュボードで可視化、Phase 5 で BI 連携拡張。

---

# 30. 非機能要件

| 項目 | 要件 |
|---|---|
| 可用性 | Vercel + Supabase の SLA に準拠（99.9% 想定） |
| レスポンス | 主要画面 1.5 秒以内、カレンダー初期描画 2 秒以内 |
| 同時接続 | 1 社あたり 100 同時接続を想定（拡張時は Supabase pooler スケール） |
| 通知到達 | outbox 経由で 99% 以上の到達率、失敗は管理画面に可視化 |
| バックアップ | Supabase 日次バックアップ + 7 日 PITR |
| データ保持 | 監査ログ 90 日以上、整備伝票 7 年、添付 5 年（設定可） |
| アクセシビリティ | WCAG 2.1 AA を意識（顧客予約画面） |
| ブラウザ対応 | 直近 2 メジャーバージョンの Chrome / Edge / Safari / Firefox |
| モバイル | iOS Safari / Android Chrome 直近 2 バージョン |

---

# 31. 重要な設計方針

ハードコードを避け、設定画面から変更できるマスタ管理型の設計。

設定画面から変更可能：
- 店舗、営業時間、定休日
- レーン数、レーン種別、レーン稼働時間
- 作業カテゴリ、作業メニュー、標準作業時間、バッファ時間
- 予約枠単位、予約期限
- ステータス、状態遷移ルール
- 回送・陸送業者、業者対応エリア / 店舗 / 曜日
- 通知方法、通知タイミング、再通知ルール
- 権限、表示項目
- 通貨、タイムゾーン（会社単位）

---

# 32. 最終的に実現したいこと

整備ピットを持つ店舗と持たない店舗が混在する販売会社でも、全店舗で整備予約・車両移動・業者通知をスムーズに管理できる状態を作る。

- 顧客は **本人確認付き** で簡単に来店予約できる
- 店舗スタッフは他店舗のピット空き状況を見て整備予約を入れられる
- 店間移動が必要な場合は、登録済みの回送・陸送業者へ **DB outbox 経由で確実に** 自動通知が送られる
- 業者はマイページで依頼を確認し、対応可否や進捗を更新できる
- 業者が「対応不可」を返した場合は、**店舗側で次候補打診や手動切替が可能**
- 店舗側は業者の状況を確認しながら、車両の移動と整備進捗を管理できる
- 整備伝票ごとに車両と作業を管理し、過去履歴を遡れる
- 作業メニューに応じて自動で予約枠が埋まり、**DB レベル排他で二重予約を構造的に防ぐ**
- 画面はシンプル、現場でモバイルでも使える
- 全データは **販売会社単位でテナント分離** され、RLS で他社漏洩を構造的に防ぐ
- 通知失敗・業者対応不可・状態遷移・PII 取扱は全て監査ログに残る
- 将来的に納車前管理、請求管理、LINE 通知、OCR、在庫管理、自社ローン管理などへ拡張できる構造

---

# 33. 未確定事項（TODO）

実装着手前に確認が必要な項目（要件は削らず TODO で残す）:

- [ ] 顧客の SMS 認証を MVP に含めるか（現状: email 認証のみ）
- [ ] 業者の SLA（応答期限）を業者マスターか依頼種別マスターか
- [ ] 自動マッチングレコメンドの初期実装範囲（MVP は手動選択でよいか）
- [ ] 業者の見積金額・請求機能を Phase 5 で実装する範囲
- [ ] 月表示カレンダーを MVP に含めるか Phase 4 か
- [ ] 表示項目設定の初期実装範囲（MVP は固定列で開始する案）
- [ ] 検索用全文インデックスの対象（vehicles / customers / service_tickets）
- [ ] 個人情報の匿名化スケジュール（顧客削除後 30 日想定）
- [ ] reCAPTCHA 等のスパム対策の追加タイミング
- [ ] Supabase Realtime をどこまで使うか（業者ステータス即時反映の MVP 採否）
