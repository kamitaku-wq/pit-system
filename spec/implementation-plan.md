# Claude Code 実装計画（改訂版 v2.2）

> 改訂日: 2026-05-22
> v2 → v2.1: Codex 総合レビュー 19 指摘 + 3 追加判断（MVP 定義 / 案件単位招待 / 楽観排他）反映。
> v2.1 → v2.2: Codex 最終レビュー反映。**通知失敗アラート / 未登録業者招待 / 業者責任分界を Phase 2 へ前倒し**、LINE/SMS を Phase 5 へ移動。

## 0. 実装時の厳守事項

- `requirements.md` v2.1 / `data-model.md` v2.1 を真の源とする
- 要件を勝手に削除しない / 別仕様に編集しない
- MVP 対象外にする場合も、将来要件として残す（v1 と同様）
- 不明点は TODO または未確定事項として残す
- シンプルな UI を優先する
- 設定画面・マスター管理を中心に設計する
- 後から LINE、SMS、請求、納車前管理、OCR、在庫管理、自社ローン管理へ拡張できる構造にする
- **PoC で技術リスクを潰してから機能実装に入る**（Phase 0 必須）

---

# 0.5. MVP 定義（v2.1 で明確化）

| 区分 | 内容 |
|---|---|
| **MVP** | **Phase 0 ～ Phase 4 全体**（顧客予約含む） |
| **MVP コア** | **Phase 2**（店間整備 + 店間移動 + 業者通知ループ） |

Phase 2 完了時点で「業者通知ループの縦切り MVP」を独立にリリースできる状態にする。Phase 3-4 は MVP の段階リリースとして追加。

---

# 1. 技術スタック（確定）

| 領域 | 採用 | 理由要約 |
|---|---|---|
| FW | Next.js 15 (App Router) + TypeScript | フルスタック TS / Server Actions / Vercel 連携 |
| Runtime | Node.js（Edge 不使用） | DB 接続・長時間処理の安定性 |
| DB | PostgreSQL 15+ (Supabase, ap-northeast-1) | RLS / exclusion constraint / JSONB / Realtime |
| ORM | Drizzle | SQL 寄りの自由度、生 SQL マイグレーション併用 |
| 認証 | Supabase Auth | 社内・業者ユーザーのみ（顧客は除外） |
| 認可 | RLS + helper function + Drizzle 側ガード | DB が境界を強制 |
| Mail | Resend + React Email | 確定済 |
| Jobs | Inngest（outbox 配送 worker）+ Vercel Cron | Cron でリマインダ / Inngest で retry |
| UI | shadcn/ui + Tailwind + FullCalendar | 管理画面と顧客画面で共有 |
| 状態管理 | Server Actions 中心、必要に応じて TanStack Query | |
| 型生成 | drizzle-kit generate / drizzle-kit pull | |
| 検証 | Zod（境界バリデーション） | |
| 監視 | Vercel Analytics / Sentry / Supabase logs | 任意 |
| Storage | Supabase Storage（添付） | |

---

# 2. ファイル構成（推奨）

```text
docs/
  requirements.md           v2
  implementation-plan.md    v2
  data-model.md             v2
  screen-list.md
  verification-checklist.md
  adr/                      新規（設計判断記録）
    0001-tenant-model.md
    0002-notification-outbox.md
    0003-status-machine.md

src/
  app/
    (admin)/
      dashboard/
      pit-calendar/
      customer-reservations/
      inter-store-service-requests/
      transport-management/
      service-tickets/
      vehicles/
      settings/
    (vendor-portal)/
      requests/
      requests/[id]/
    (customer)/
      reserve/
      reservation/[token]/      # 顧客本人確認 token 経由
    api/
      webhooks/                  # Resend / Inngest webhook
      inngest/                   # /api/inngest

  domains/
    companies/
    stores/
    lanes/
    lane-types/
    work-categories/
    work-menus/
    reservations/
      services/                 # confirmReservation, cancelReservation 等
      transitions.ts            # ステータス遷移マップ
      slots/                    # 空き枠計算
    service-tickets/
    vehicles/
    customers/
      tokens/
    transport-orders/
      vendor-matching/
      fallback/
    vendors/
      portal-access/
    notifications/
      outbox/                   # outbox insert / dispatch
      templates/                # React Email テンプレート
    audit/
    statuses/
    users/
    permissions/

  lib/
    auth/                       # Supabase Auth helpers
    db/                         # Drizzle client, schema export
    rls/                        # RLS helper SQL
    mail/                       # Resend client
    inngest/                    # client, functions
    scheduling/                 # tstzrange utilities
    tokens/                     # 顧客 token 発行・検証
    tz/                         # JST 表示変換

  components/
    calendar/
    forms/
    tables/
    status/
    notifications/

  drizzle/
    schema/                     # *.ts
    migrations/
      sql/                      # 手書き SQL（RLS, exclusion 等）

  tests/
    e2e/                        # Playwright
    rls/                        # RLS 漏洩テスト（重要）
    concurrency/                # 並列予約テスト
    outbox/                     # 通知 outbox / リトライ
    unit/
```

---

# 3. Phase 構成（v2 で再構成）

> v1 は Phase 2 にカレンダー全表示・顧客予約を入れ、業者通知が Phase 3 だった。これは `CLAUDE.md` の Most Important Feature と矛盾するため、**最重要ループ（店間移動 + 業者通知）を Phase 2 へ前倒し**。

## Phase 0：基盤 PoC（機能実装の前段、必須）

**目的**: 技術スタックの致命的リスクを潰す。

| # | 内容 | 完了基準 |
|---|---|---|
| 0.1 | リポジトリ初期化 / CI / Drizzle / Supabase ローカル | `drizzle-kit generate` & `supabase start` が動く |
| 0.2 | `companies` / `users` / `vendor_users` 最小スキーマ + RLS | 社内ユーザーが自社のみ閲覧、業者ユーザーが自社案件のみ閲覧 |
| 0.3 | **RLS 漏洩テスト** | 会社 A/B、専属業者、共有業者、顧客トークンで他社 row が 0 件 |
| 0.4 | `reservations` 最小スキーマ + exclusion constraint | 同一 lane 重複 INSERT が DB で拒否 |
| 0.5 | **並列予約確定テスト** | 50 並列 → 1 件成功 / 残り business error |
| 0.6 | `notification_outbox` 最小スキーマ + Inngest 配送 | Inngest worker が outbox を pickup → Resend 送信 → `notification_deliveries` 記録 |
| 0.7 | **TX + outbox + Inngest retry テスト** | Inngest 落としても outbox 残り、復旧後 1 度だけ送信 |
| 0.8 | **業者ポータル権限モデル PoC** | 専属 / 共有 / 案件単位招待を RLS で表現 |
| 0.9 | **Vercel runtime PoC** | Node.js runtime 固定、Supabase pooler で接続数 OK |
| 0.10 | 監査ログトリガ PoC | 主要テーブル変更が `audit_logs` に redacted JSON で記録 |
| 0.11 | TZ 動作テスト | UTC 保存 / JST 表示、夏時間なしの確認 |
| 0.12 | **マイグレーション順序検証**（v2.1） | `data-model.md` §17 通りに 1〜21 を流して FK 依存エラーなし |
| 0.13 | **outbox FOR UPDATE SKIP LOCKED**（v2.1） | 並列 dispatcher 2 つを同時起動して二重送信なし |
| 0.14 | **楽観排他テスト**（v2.1） | 同一行を異なる version で 2 並列更新 → 1 件成功 / 1 件 OptimisticLockError |
| 0.15 | **案件単位招待の先着受注**（v2.1） | 3 業者へ同時招待 → 2 業者同時 accept → 1 業者のみ winning_bid、他は revoked |
| 0.16 | **PII redaction**（v2.1） | customers / vehicles の UPDATE で audit_logs に元の PII が残らない |

**完了基準**: 上記 16 項目すべて自動テスト化 → CI で常時実行。

---

## Phase 1：マスター設定・認証基盤

**目的**: 業務データを乗せる前のマスター・認証を整備。

| # | 内容 |
|---|---|
| 1.1 | 会社設定（`companies` 編集画面、本部管理者のみ） |
| 1.2 | 認証フロー（Supabase Auth、社内ユーザー招待） |
| 1.3 | ロール / 権限設定（`roles` / `permissions`） |
| 1.4 | 店舗設定（`stores` / `store_business_hours` / `store_holidays`） |
| 1.5 | レーン種別設定（`lane_types`） |
| 1.6 | レーン設定（`lanes` / `lane_working_hours` / `lane_work_menus`） |
| 1.7 | 作業カテゴリ設定（`work_categories`） |
| 1.8 | 作業メニュー設定（`work_menus`） |
| 1.9 | 予約枠設定（`reservation_settings`） |
| 1.10 | ステータス設定（`statuses` / `status_transitions`） |
| 1.11 | **回送・陸送業者マスター**（`vendors` / `vendor_users` / `vendor_service_areas` / `vendor_available_stores` / `vendor_available_days`） |
| 1.12 | 通知ルール設定（`notification_rules`） |
| 1.13 | 標準シードデータ投入（初期 lane_types / statuses / status_transitions / notification_rules） |

---

## Phase 2：店間整備 + 店間移動 + 業者通知（**最重要ループの縦切り MVP**）

**目的**: システムの命綱である業者通知ループを早期に完全動作させる。

| # | 内容 |
|---|---|
| 2.1 | 整備伝票作成（`service_tickets`、最小フォーム） |
| 2.2 | 車両情報入力（`vehicles` / `vehicle_ownerships`） |
| 2.3 | 店間整備予約作成（`reservations`, type=inter_store） |
| 2.4 | 作業メニュー選択 → 予約枠自動確保（標準時間・バッファ反映） |
| 2.5 | **TX 内で予約 + 整備伝票 + transport_order + outbox 生成**（service 関数で `drizzle.transaction()`） |
| 2.6 | **店間移動パターン 4 種**（one_way / round_trip / pickup_only / three_point） |
| 2.7 | 業者選択 UI（手動選択 + 対応エリア / 店舗 / 曜日フィルタ） |
| 2.8 | 走行可否 → `tow_required` 自動化 |
| 2.9 | 業者宛メール送信（React Email + Resend、idempotency_key 付き） |
| 2.10 | 業者マイページ通知レコード作成 |
| 2.11 | 業者ポータル：新規依頼一覧 / 依頼詳細 |
| 2.12 | 業者ポータル：対応可否回答 + 引取/搬入/返却予定日時入力 |
| 2.13 | 業者ポータル：完了報告 + 備考入力 |
| 2.14 | 店舗側：業者状況確認画面（`transport-management/`） |
| 2.15 | 状態遷移実装（`*_status_history` append-only + DB check） |
| 2.16 | **業者対応不可フォールバック**：次候補打診 / 希望日時変更 / 手動切替 / キャンセル |
| 2.17 | `transport_order_vendor_attempts` の試行履歴管理 |
| 2.18 | `transport_order_change_logs` 差分管理 + 変更通知 |
| 2.19 | **confirmation_mode**（auto / manual）切替、`store_confirmed_at` 管理 |
| 2.20 | 通知失敗の運用画面（outbox `status='failed'` 一覧） |
| 2.21 | **案件単位招待**（`transport_order_invitations`）：複数業者一斉打診 UI、招待トークン URL、先着受注ロジック、残り招待の自動 revoke |
| 2.22 | **業者ポータル inbox**（`vendor_portal_inbox`）：未読/既読管理、severity 表示 |
| 2.23 | **outbox dispatcher**：`SELECT ... FOR UPDATE SKIP LOCKED` + stale processing リカバリ Cron |
| 2.24 | **楽観排他**（version カラム + IF MATCH UPDATE）：reservations / transport_orders / vendors 等 |
| 2.25 | **service_role 監査**：Inngest worker 冒頭で `audit_logs` に `actor_kind='system'` 記録 |
| 2.26 | **status_transitions DB trigger**：許可遷移を `BEFORE INSERT` で検証 |
| 2.27 | **通知失敗アラート**（v2.2 で Phase 4 → Phase 2 前倒し）：連続失敗 N 件で Slack / メール通知、運用担当者へ即時エスカレーション |
| 2.28 | **未登録業者招待フロー**（v2.2）：招待 URL → 受諾画面 → Supabase Auth 招待メール → `vendor_users` 登録 → `bound_vendor_id` 紐付け |
| 2.29 | **業者責任分界**（v2.2）：承諾証跡（タイムスタンプ + IP + 同意フラグ）、回送依頼書 PDF への免責文言、業者進捗未更新時のアラート |

**完了基準**: 店間移動を伴う 1 予約を作成 → 業者通知 → 業者対応可 → 店舗確定 → 完了 までを E2E で通せる。失敗系（業者不可・通知失敗・楽観排他競合・案件単位招待の先着受注 / 未登録業者招待）も再現可能。

---

## Phase 3：カレンダー + 整備伝票 + 車両管理

**目的**: 日常運用のための一覧・カレンダー機能。

| # | 内容 |
|---|---|
| 3.1 | ピット予約カレンダー（日表示 / 週表示） |
| 3.2 | 店舗別表示 / レーン別表示 |
| 3.3 | 作業種別表示 |
| 3.4 | 整備伝票一覧 + 検索 / フィルタ |
| 3.5 | 車両一覧 + 検索 / フィルタ |
| 3.6 | 車両の過去整備履歴ビュー（`service_tickets` を `vehicle_id` で遡る） |
| 3.7 | 業者通知・回送管理一覧（Phase 2 の補強表示） |
| 3.8 | ダッシュボード（本日予約 / 業者未確認 / 対応不可 / 作業中 / 完了） |
| 3.9 | CSV エクスポート（整備伝票 / 予約 / 通知履歴） |
| 3.10 | 印刷レイアウト（整備伝票 / 回送依頼書） |

---

## Phase 4：顧客予約 + 本人確認 + リマインド

**目的**: 顧客向け予約 UI と通知拡張。

| # | 内容 |
|---|---|
| 4.1 | 顧客予約フロー（店舗 → メニュー → 空き日時 → 顧客情報 → 車両情報） |
| 4.2 | **email 認証コード本人確認** |
| 4.3 | 予約完了メール（modify / cancel 用署名 URL 付き） |
| 4.4 | `customer_reservation_tokens` 管理（発行 / 検証 / 失効） |
| 4.5 | 顧客側予約変更画面 |
| 4.6 | 顧客側キャンセル画面 |
| 4.7 | スパム対策（レート制限 / 簡易ハニーポット） |
| 4.8 | 予約前日リマインド（Inngest scheduled + outbox） |
| 4.9 | 業者未確認再通知（`retry_after_minutes` 経過時） |
| 4.10 | 月表示カレンダー |
| 4.11 | 管理画面内通知（社内ユーザー宛 outbox） |

> **v2.2 で Phase 5 へ移動**: LINE 通知 / SMS 通知は本人確認・配信失敗運用・コストが MVP の範囲を超えるため将来拡張に移した。outbox の channel 抽象化だけは MVP で完成させ、後から追加可能な構造を保つ。

---

## Phase 5：将来拡張

要件 §29 の項目を順次実装。各機能を独立に追加できる構造を維持。

- **LINE 通知 / SMS 通知**（v2.2 で Phase 4 から移動）— outbox の channel 抽象化を活用、LINE 公式アカウント連携・SMS プロバイダ選定が必要
- 顧客マイページ（Auth 化）
- 請求管理 / 売上管理
- 整備士別作業負荷管理
- 部品発注管理 / 外注管理
- 納車前管理
- 車検証 OCR（添付画像 → VIN / ナンバー / 名義）
- 在庫車両管理
- 自社ローン審査管理
- ダッシュボード分析（マテリアライズドビュー / ClickHouse 連携）
- 外部 API 連携（Webhook）
- 業者の自動マッチングレコメンド強化

---

# 4. 主要ドメイン

`data-model.md` v2 と 1:1 対応。主要ドメイン：

- Company（テナント）
- User / Role / Permission / VendorUser
- Store / StoreBusinessHour / StoreHoliday
- LaneType / Lane / LaneWorkingHour / LaneWorkMenu
- WorkCategory / WorkMenu
- Reservation / ReservationStatusHistory / ReservationSettings
- ServiceTicket
- Vehicle / VehicleOwnership
- Customer / CustomerReservationToken
- Vendor / VendorCompanyMembership / VendorServiceArea / VendorAvailableStore / VendorAvailableDay
- TransportOrder / TransportOrderStatusHistory / TransportOrderChangeLog / TransportOrderVendorAttempt
- NotificationOutbox / NotificationDelivery / NotificationRule
- Status / StatusTransition
- AuditLog
- Attachment

---

# 5. 予約枠自動確保ロジック（service 関数）

```
function confirmReservation(input):
  drizzle.transaction(async tx => {
    // 1. 入力検証（Zod）
    // 2. 権限確認（RLS 経由 + アプリ側で再確認）
    // 3. WorkMenu 取得 → standard_duration_minutes / buffer_minutes / required_slot_count
    // 4. レーン候補抽出（lane_work_menus + lane_working_hours + store_business_hours）
    // 5. 排他: INSERT を試みる → exclusion constraint で衝突時はリトライ or business error
    // 6. service_ticket 紐付け（既存 or 新規作成）
    // 7. 店間移動あり → transport_order 作成 + vendor_attempt 記録
    // 8. status_history 追記
    // 9. notification_outbox に idempotency_key 付きで insert（必要に応じ）
    // 10. audit_logs 記録
  })
```

注意：
- レーン種別は設定画面で追加・変更可能
- 作業メニューは設定画面で追加・変更可能
- 予約単位は設定画面で変更可能
- 重複予約の許可・不許可は設定画面で変更可能
- 店長権限上書きは設定画面で変更可能
- フリー入力メニューは想定作業時間の上書きを許可

---

# 6. 店間移動・業者通知ロジック（service 関数）

```
function confirmInterStoreReservationWithTransport(input):
  drizzle.transaction(async tx => {
    // 1. 通常の予約作成（§5 のロジック）
    // 2. service_ticket 紐付け
    // 3. transport_order 作成
    //    - movement_type / pickup_store_id / delivery_store_id / return_store_id
    //    - can_drive / tow_required / 希望日時
    //    - vendor_id（手動選択）
    //    - confirmation_mode（auto/manual、デフォルト auto）
    // 4. transport_order_vendor_attempts 第 1 試行記録
    // 5. notification_rules を確認、該当イベントの通知ルール取得
    // 6. ルールに従い notification_outbox へ insert
    //    - idempotency_key: "transport_order:{id}:confirmed:v1"
    //    - target_type: 'vendor', target_id: vendor_id
    //    - payload: 必要情報を JSON 化
    // 7. transport_order_status_history 初期遷移記録
    // 8. audit_logs 記録
  })

  // TX 外 (Inngest が pickup)
  // 9. Inngest dispatcher: outbox status='pending' を取得
  // 10. Resend でメール送信
  // 11. notification_deliveries に result='sent' を記録
  // 12. 失敗時: attempts++, next_attempt_at = now + backoff
  // 13. 業者が確認 → vendor_users 経由でアクセス、status='confirmed' へ更新（status_transitions チェック）

function handleVendorRejection(transport_order_id, reason):
  drizzle.transaction(async tx => {
    // 1. transport_orders.vendor_response = 'rejected', vendor_rejection_reason 記録
    // 2. vendor_attempts.response = 'rejected'
    // 3. 状態遷移：'業者通知済み' → '業者対応不可'
    // 4. 店舗側通知 outbox 追加（社内ユーザー宛）
  })
  // 後続アクションは店舗スタッフ操作（次候補 / 希望日時変更 / 手動切替 / キャンセル）
```

---

# 7. 通知設計（再掲・要点）

| 項目 | 設計 |
|---|---|
| 送信元 | `notification_outbox`（DB） |
| 配送 | Inngest function（**`FOR UPDATE SKIP LOCKED`** で pending row を pickup） |
| プロバイダ | Resend（email） / `vendor_portal_inbox`（portal、v2.1 で分離） |
| 重複防止 | `idempotency_key UNIQUE` |
| リトライ | `attempts` / `max_attempts` / `next_attempt_at`（指数バックオフ） |
| 失敗ハンドリング | `status='failed'` で運用画面に表示、手動再送可能 |
| 差分管理 | `transport_order_change_logs` で before/after JSON（PII redacted） |
| スケジュール送信 | `scheduled_at`（前日リマインダ用） |
| 配送ログ | `notification_deliveries`（result, provider_message_id、ログ専用） |
| stale 復旧（v2.1） | `processing_started_at < now() - 15min` の row を `pending` に戻す Cron（5 分間隔） |
| 認可（v2.1） | dispatcher は service_role 使用、冒頭で audit_logs に記録 |

---

# 8. 主要画面

詳細は `screen-list.md` 参照。

## 管理画面（社内ユーザー）
- ダッシュボード
- ピット予約カレンダー
- 顧客予約一覧
- 店間整備依頼
- 業者通知・回送管理（**Phase 2 で最優先実装**）
- 整備伝票一覧
- 車両一覧
- 通知失敗・運用画面
- 監査ログ閲覧
- 設定

## 設定画面
- 会社設定
- 店舗 / 営業時間 / 休日
- レーン種別 / レーン / 稼働時間
- 作業カテゴリ / 作業メニュー
- 予約枠
- ステータス / 状態遷移ルール
- 回送・陸送業者マスター
- 通知ルール
- 権限
- 表示項目
- 顧客本人確認設定
- 監査ログ設定

## 業者ポータル（vendor_users）
- 新規依頼一覧
- 依頼詳細
- 対応可否回答
- 引取 / 搬入 / 返却予定入力
- 引取 / 搬入 / 返却完了報告
- 備考入力

## 顧客予約画面（token / email 認証）
- 店舗選択
- 作業メニュー選択
- 空き日時確認
- 顧客情報入力
- 車両情報入力
- 認証コード入力
- 予約完了
- 予約確認（token URL）
- 予約変更（modify token）
- キャンセル（cancel token）

---

# 9. 実装時の注意点

## 9.1 ハードコード禁止に近い項目（v1 から継承）

設定画面・マスターから変更できるようにする：
- 店舗、営業時間、定休日
- レーン数、レーン種別、レーン稼働時間
- 作業カテゴリ、作業メニュー、標準作業時間、バッファ時間
- 予約枠単位
- ステータス、状態遷移ルール
- 回送・陸送業者、業者対応エリア / 店舗 / 曜日
- 通知方法、通知タイミング、再通知ルール
- 権限、表示項目
- 通貨、タイムゾーン（会社単位）

## 9.2 削ってはいけない要件（v1 から継承 + v2 追加）

v1 由来:
- レーン数や作業内容のプルダウン選択
- メンテナンス専用レーンと重整備専用レーンの分離管理
- 重整備のフリー入力
- メニューによる予約枠自動確保
- 整備伝票ごとの車両管理
- 顧客の来店予約
- 店間整備予約
- 店間移動発生時の登録業者へのメール通知
- 店間移動発生時の業者用マイページ通知
- 業者マイページでの対応可否・進捗更新
- 店舗側での業者確認状況・進捗確認
- すべて設定画面から変更できる設計
- シンプルなレイアウト
- 将来拡張性

v2 で追加（削れない）:
- 販売会社単位のテナント境界（RLS）
- 業者ポータルの他社・他業者からの完全分離
- 予約枠の DB レベル排他（exclusion constraint）
- 通知 outbox + idempotency_key
- 状態遷移ルールマスター + append-only 履歴
- 業者対応不可時のフォールバックフロー
- 店間移動 4 パターン全対応
- 顧客本人確認（email 認証コード + 署名トークン）
- 監査ログ全件 append-only
- TZ: UTC 保存 / JST 表示
- 金額の通貨・税・最小単位（minor）保存

## 9.3 NG パターン

- アプリ側「find then insert」での予約衝突回避 → exclusion constraint 必須
- service_role を Server Actions / Route Handlers で直叩き → 認可破綻
- Server Actions を TX 境界と誤認 → service 関数で `drizzle.transaction()` 必須
- 通知を Inngest だけで idempotency 担保 → outbox の DB UNIQUE で恒久重複防止
- 顧客を Supabase Auth user 化 → MAU 課金 / 認証フロー過剰 → token table 採用
- 配列カラムで関連保持 → M2M テーブル化必須
- **outbox 取得を `FOR UPDATE SKIP LOCKED` なしで実行**（v2.1）→ 重複起動時に二重送信、必ず SKIP LOCKED で取る
- **楽観排他なしで UPDATE**（v2.1）→ 同時編集の上書き事故、`WHERE version = ?` IF MATCH 必須
- **transport_orders を movement_type CHECK なしで作成**（v2.1）→ 不整合 row（pickup_only なのに delivery 入り等）が混入、DB CHECK 制約必須
- **audit_logs に PII 生 JSON 保存**（v2.1）→ コンプライアンス違反、必ず `redact_audit_payload()` 経由
- **status_transitions の TS 検証のみで DB trigger なし**（v2.1）→ アプリバグで不正遷移、DB trigger を最終防衛線として併用
- **notification_deliveries を inbox 兼用**（v2.1）→ UI の未読管理・再表示が破綻、`vendor_portal_inbox` を分離

---

# 10. テスト戦略

| レイヤ | ツール | 対象 |
|---|---|---|
| 単体 | Vitest | service 関数 / 状態遷移ロジック / token 検証 |
| RLS | pgtap / カスタムテスト | 全テーブルのテナント分離 / 業者ポータル分離 |
| 同時実行 | Vitest + 並列ジョブ | 予約二重確定 / outbox 重複 |
| 統合 | Vitest + Supabase local | TX + outbox + 状態遷移 |
| E2E | Playwright | 顧客予約 / 業者ポータル / 店間移動フル |
| 通知 | Inngest local dev | outbox 配送 / リトライ / 失敗ハンドリング |
| 印刷 | Playwright PDF | 整備伝票 / 回送依頼書 |

**MVP 着手前に Phase 0 PoC を全自動テスト化、CI に組み込む**。

---

# 11. デプロイ戦略

| 環境 | 用途 |
|---|---|
| local | Supabase local（Docker）+ Next.js dev + Inngest dev |
| preview | Vercel preview deploy + Supabase preview project（または共通 staging） |
| staging | Vercel preview の固定 URL + Supabase staging |
| production | Vercel production + Supabase production（ap-northeast-1 Tokyo） |

- マイグレーションは `drizzle-kit` + 手書き SQL（RLS / exclusion / トリガ）
- preview 環境では DB を共通の staging に向けるか、ブランチ DB（Supabase branch）を使う
- production リリースは migration → コードデプロイ → smoke test の順
- Inngest events は環境ごとに分離（branch key）

---

# 12. 監視・運用

| 項目 | ツール |
|---|---|
| アプリエラー | Sentry（任意） |
| アクセス | Vercel Analytics |
| DB | Supabase Logs / Metrics |
| 通知失敗 | 管理画面の outbox 失敗一覧（`status='failed'`） |
| パフォーマンス | Vercel Speed Insights |
| 監査 | `audit_logs` の閲覧画面 |

通知失敗が連続発生した場合のアラート（Slack / メール）は Phase 4 以降。

---

# 13. 工数感（概算）

> 1 エンジニア相当の換算。並列開発でさらに短縮可。

| Phase | 範囲 | 概算 |
|---|---|---|
| Phase 0 | PoC 11 項目 | 1.5 〜 2 週間 |
| Phase 1 | マスター・認証 | 3 〜 4 週間 |
| Phase 2 | 店間移動 + 業者通知ループ | 4 〜 6 週間 |
| Phase 3 | カレンダー + 一覧 + 印刷 | 3 〜 4 週間 |
| Phase 4 | 顧客予約 + 通知拡張 | 3 〜 4 週間 |
| **MVP 合計** | Phase 0-4 | **14 〜 20 週間** |
| Phase 5 | 将来拡張 | 機能ごとに別案件 |

要件 § / 機能粒度 / チーム規模 / 既存資産で変動。Codex 委任で短縮可能。

---

# 14. リスク管理

| リスク | 影響 | 緩和策 |
|---|---|---|
| RLS 設計ミスで他社漏洩 | 致命的 | Phase 0 PoC + pgtap 自動テスト常時実行 |
| 通知配送失敗の見逃し | 業者対応漏れ | outbox `status='failed'` 監視画面 + 手動再送 |
| 予約二重確定 | 業務混乱 | exclusion constraint + 並列テスト |
| 業者対応不可で案件停止 | 業務停止 | フォールバック UI + 次候補打診 |
| Inngest / Vercel Cron の停止 | 通知遅延 | outbox が残るので復旧後送信、SLA 監視 |
| Supabase 課金増加 | コスト悪化 | 顧客を Auth 化しない（MAU 抑制） |
| マイグレーション失敗 | リリース失敗 | Supabase PITR + ロールバック SQL 用意 |
| PII 漏洩 | 法的リスク | RLS + 監査ログ + 添付署名 URL |

---

# 15. 関連 ADR（作成予定）

- ADR-0001: テナントモデル（販売会社単位、RLS による境界）
- ADR-0002: 通知配送（DB outbox + Inngest + FOR UPDATE SKIP LOCKED）
- ADR-0003: 状態遷移管理（`status_transitions` + append-only history、DB trigger と TS map の責務分界）
- ADR-0004: 業者ポータルの認可境界（vendor_users 分離 + RLS helper function）
- ADR-0005: 顧客本人確認（Auth user 化せず token table）
- ADR-0006: 予約枠排他（exclusion constraint + tstzrange）
- ADR-0007: 同時編集の楽観排他（version カラム + IF MATCH、v2.1）
- ADR-0008: 案件単位招待と先着受注の競合解決（transport_order_invitations、v2.1）
- ADR-0009: PII redaction policy と監査ログ append-only 保護（v2.1）
- ADR-0010: service_role の使用範囲と Inngest worker 監査（v2.1）

---

# 16. 未確定事項（TODO、要件は削らない）

- [ ] 顧客 SMS 認証を MVP に含めるか（現状 email のみ）
- [ ] 業者 SLA を業者マスターか依頼種別か
- [ ] 自動マッチングレコメンドの MVP 範囲
- [ ] 月表示カレンダーを Phase 3 に含めるか Phase 4 か
- [ ] 表示項目設定の初期実装範囲
- [ ] reCAPTCHA / hCaptcha 導入タイミング
- [ ] Supabase Realtime の活用範囲
- [ ] 検索用全文インデックス対象
- [ ] PII 匿名化の自動化スケジュール（顧客削除 30 日後想定）
- [ ] 業者の見積金額機能の実装フェーズ
- [ ] 多言語対応（現状 JST / JPY のみ）

---

# 17. 完了の定義（Definition of Done）

各 Phase / 機能の DoD：

- 関連する要件項目を `requirements.md` で参照可能
- データモデルが `data-model.md` v2 と整合
- service 関数に対応する単体テストあり（カバレッジ 80% 目標）
- RLS 影響範囲はテストで分離検証
- 並列・通知・状態遷移は統合テストあり
- 主要 UX フローは E2E あり
- 監査ログが残っているか確認
- 設定変更で動作変更できるか確認（ハードコードなし）
- 関連 ADR 更新
- PR は code-reviewer agent + Codex 並走レビュー（高 stake は必ず）
- 既存テスト全グリーン
