# Phase 68 先行確認: β機能のDBスキーマ充足 (直列ボトルネック前倒し調査)

## メタ
| 項目 | 値 |
|---|---|
| 作成 | 2026-05-30 |
| 目的 | β完走の最大の直列ボトルネック「新規スキーマ確定」が必要かを並列実装の**前に**判定する |
| 手法 | β各機能が要求するデータ vs 実装スキーマ (`src/lib/db/schema/*.ts`) + requirements §28/§29.5.1 を突き合わせ |
| 結論 | **新規テーブルは不要。β機能は既存46テーブルの上に UI/集計を載せるだけで実装可能。** 新規 migration 候補は `statuses.color` 1カラム(任意)のみ |

## 含意 (並列計画にとって最重要)
- スキーマ確定フェーズ (直列・main 専管) が **ほぼ空** → β機能は即レーン並列に入れる。
- 例外: ステータス色分けを会社カスタム対応にするなら `statuses.color` 追加 (軽微・1カラム)。フロント定数マップで回避すれば migration ゼロ。
- = 「スキーマ衝突によるマージ地獄」のリスクが構造的に低い。worktree 並列に向く。

## β機能別 データ充足表

### 1. 店舗別ピット稼働ビュー + カレンダー店舗/レーン別 (★核心, requirements §28/§240)
| 必要データ | 既存スキーマ | 状態 |
|---|---|---|
| 予約 (店舗別/レーン別/時間/ステータス/作業種別) | `reservations`: storeId(NN), laneId(NN), startAt(NN), endAt(NN), statusId, workMenuId, customerId, vehicleId, serviceTicketId | ✅ 完備 |
| レーン定義 (店舗紐付け・容量) | `lanes`: storeId, laneTypeId, capacity, isActive | ✅ |
| レーン稼働時間 (稼働率の分母) | `lane_working_hours`: laneId, dayOfWeek, startsAt, endsAt | ✅ |
| 店舗営業時間/休日 | `store_business_hours`(opensAt/closesAt/acceptsReservations), `store_holidays`(holidayDate/isClosed) | ✅ |
| 作業種別フィルタ | `work_categories` / `work_menus` / `reservations.workMenuId` / `lane_work_menus` | ✅ |
| 店間移動/業者手配バッジ | `transport_orders.reservationId` で予約に紐付け (movementType, pickup/delivery/returnStoreId, vendorResponse, statusId) | ✅ join で可 |
| ステータス色分け | `statuses`(statusType/key/name/displayOrder) に **color カラム無し** | ⚠️ 下記参照 |

### 2. レーン稼働率 (requirements §29.5.1: `稼働率 = 予約済み分数 / 稼働可能分数 × 100`)
- 予約済み分数 = `reservations.endAt - startAt` の合計 (startAt/endAt は NOT NULL なので確実。`durationMinutes` は nullable 補助列)。✅
- 稼働可能分数 = `lane_working_hours` (startsAt〜endsAt × 対象曜日) − `store_holidays`。✅
- → **新規テーブル不要で計算可能。**

### 3. 整備伝票 / 車両強化 (β-2)
- `service_tickets`: vehicleId, customerId, storeId, statusId, workCategoryId, workMenuId, ticketNo, quotedAmountMinor, taxRateBps, billingStatus, notes → 課金項目まで完備。✅
- `vehicles`: vin, registrationNumber, maker, model, modelYear, color, storeId + `vehicle_ownerships` → ✅

### 4. 顧客予約フロー (β-3)
- `reservations` + `customer_reservation_tokens` + `reservation_verification_codes` + `reservation_settings` (slotInterval/leadTime/maxAdvance/cancellationDeadline/buffer) → ✅ 予約枠ロジックの値は揃う。

### 5. 設定画面の欠落 (UI欠落であってスキーマは充足)
| 画面 | 既存スキーマ | 状態 |
|---|---|---|
| 会社設定 §3.1 | `company_settings` (key/value jsonb) | ✅ 汎用KVで格納可。画面が空なだけ |
| 予約枠設定 §3.9 | `reservation_settings` (全カラム有) | ✅ 専用画面が無いだけ |
| 監査ログ閲覧 §1.9 | `audit_logs` (entityType/action/actor/before/afterJson/ip/ua) | ✅ データ構造完備。閲覧UIが無いだけ |
| 表示項目設定 §3.16 | `system_settings` / `company_settings` (jsonb) | ✅ KVで格納可 |

## 唯一のスキーマギャップ: `statuses.color`
- 事実: `src/lib/db/schema/statuses.ts` に色カラムは無い (statusType/key/name/displayOrder/isInitial/isTerminal/isActive)。
- 影響: screen-list §1.2 の「ステータス色分け」。
- 選択肢:
  - (A) **フロント定数マップ** (`statusType:key → color`) で対応 → migration ゼロ。会社共通色なら十分。
  - (B) `statuses` に `color text` 追加 → 会社が任意ステータスを追加・色指定できる (statuses は companyId 別なので本来こちらが整合的)。軽微な1カラム migration。
- 推奨: 会社カスタムステータスに色を持たせる設計なら (B)。α/demo を急ぐなら (A) で先行し後で (B) に移行も可。

## 再利用できそうな既存集計サービス (計画時に中身確認)
- `src/lib/services/calendar-events.ts` — カレンダーイベント集計の土台が既にある可能性。
- `src/lib/services/reservation-availability.ts` — 空き枠計算。ピット稼働/空き枠ドラッグ作成に再利用候補。
- → ピット稼働ビューは「ゼロからの集計実装」ではなく既存サービス拡張で済む可能性。監査結果と併せて要確認。

## 次アクション
- 監査 (phase-68-feature-audit.md, 実行中) の結果と統合し、レーン割り当て・着手順を確定。
- スキーマ先行フェーズは (B)を採るなら `statuses.color` の1 migration のみ。それ以外のβ機能は既存スキーマで並列着手可能。

---
*Phase 68 先行 / Claude 2026-05-30 / スキーマは β 完走に対し充足。直列ボトルネックは事実上ほぼ無し。*
