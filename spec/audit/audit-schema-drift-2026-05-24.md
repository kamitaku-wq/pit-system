---
# Schema Drift Audit (2026-05-24)

- 監査日: 2026-05-24
- 監査担当: Claude + Codex (codex:codex-rescue, --effort high)
- 監査対象: `src/lib/db/raw-migrations/alpha-1-public/*.sql` 全 22 ファイル × `spec/data-model.md` v2.4 §7-§14
- きっかけ: D-2 動作確認中に `notification_outbox.target_type` の channel/recipient 意味論逆を発見 (commit 615950c で dispatcher 側修正) → advisor 指摘で全テーブル audit
- 結果: 18 テーブルで drift、critical 7 件
- 影響: Sprint α-1 sealed の前提が崩れ、α-2 (5/28-29) を reconciliation sprint に切替決定

## §1 サマリー表

| テーブル | severity | 主な drift |
|---|---|---|
| transport_orders | critical | movement_type 値域逆転 + 18 列欠落 |
| statuses | critical | domain vs status_type 命名逆、CHECK 欠落 |
| transport_order_invitations | critical | invited_at 等 4 列欠落、UNIQUE 欠落 |
| transport_order_vendor_attempts | critical | attempt_seq 等 5 列欠落、response CHECK mismatch |
| vendor_sla_overrides | critical | work_category_id 等 7 列欠落、UNIQUE 逆転 |
| notification_deliveries | critical | outbox_id 等 6 列欠落、channel CHECK 欠落 |
| vendor_selection_logs | critical | selected_vendor_id 等 7 列欠落、selection_reason CHECK 欠落 |
| vendors | high | contact_person_name 等 8 列、status CHECK 値域違い |
| vendor_company_memberships | high | is_enabled 等 命名違い + 列差異 |
| vendor_service_areas | high | area_code 欠落、surrogate id vs 複合 PK |
| vendor_available_days | high | starts_at/ends_at 命名違い + PK 形式違い |
| transport_order_status_history | high | to_status_id 等 命名逆 |
| transport_order_change_logs | high | change_type CHECK 等 5 列欠落 |
| notification_rules | high | event_type 等 4 列欠落、channel CHECK 欠落 |
| status_transitions | high | status_type 等 4 列欠落 |
| reservation_settings | high | slot_unit_minutes 等 12 列欠落 |
| attachments | high | entity_type 等 5 列欠落、FK 直結方式差異 |
| vendor_available_stores | low | PK 形式 (surrogate vs 複合) — 機能差なし |

## §2 Critical 7 件の詳細

### 2.1 transport_orders
- File: alpha-1-public/12_transport.sql / Spec: data-model.md §7.6-§7.6.2
- (a) spec にあり migration に無い列: order_number, return_store_id, can_drive, requested_return_at, scheduled_pickup_at, scheduled_delivery_at, scheduled_return_at, picked_up_at, delivered_at, returned_at, vendor_response, vendor_response_at, vendor_rejection_reason, confirmation_mode, store_confirmed_at, store_confirmed_by_user_id, notification_sent_at, deleted_at
- (b) migration にあり spec に無い列: customer_id, pickup_address, delivery_address, assigned_at, accepted_at, completed_at, price_minor
- (c) movement_type: migration=`self_drive/tow/carrier` vs spec=`one_way/round_trip/pickup_only/three_point` — 意味論逆転
- (d) UNIQUE(company_id, order_number) 欠落; service_ticket_id/vehicle_id nullable vs spec NOT NULL
- 影響度: α-2 必須

### 2.2 statuses
- File: alpha-1-public/03_roles_statuses.sql / Spec: §9.1
- (a) spec にあり migration に無い列: status_type CHECK(reservation/service/transport/vendor), key, display_order, is_initial, is_active
- (b) migration にあり spec に無い列: domain, code, sort_order
- (c) status_type/domain CHECK 値域不一致
- (d) company_id nullable vs spec NOT NULL; UNIQUE(domain,code) vs spec UNIQUE(status_type,key)
- 影響度: α-2 必須 (transport_orders/reservations/service_tickets 全てが status_id FK)

### 2.3 transport_order_invitations
- File: alpha-1-public/12_transport.sql / Spec: §7.10-§7.10.2
- (a) spec にあり migration に無い列: invited_at (NOT NULL DEFAULT now()), invitee_name, invitee_phone, bound_vendor_id (FK)
- (b) migration にあり spec に無い列: bound_at, created_at, updated_at, deleted_at
- (c) なし
- (d) invitations_target_check 欠落; UNIQUE(invitation_token_hash) 欠落; partial UNIQUE 各種欠落
- 影響度: α-2 必須

### 2.4 transport_order_vendor_attempts
- File: alpha-1-public/12_transport.sql / Spec: §7.9
- (a) spec にあり migration に無い列: attempt_seq (NOT NULL), requested_at (NOT NULL), response CHECK(pending/accepted/rejected/timeout), responded_at, rejection_reason
- (b) migration にあり spec に無い列: attempt_no, status, updated_at
- (c) response/status CHECK mismatch (status は CHECK なし vs response は 4 値 CHECK)
- (d) vendor_id nullable vs spec NOT NULL; UNIQUE(transport_order_id, attempt_seq) 欠落
- 影響度: α-2 必須 (vendor フォールバックロジックで使う)

### 2.5 vendor_sla_overrides
- File: alpha-1-public/09_vendors.sql / Spec: §7.5b
- (a) spec にあり migration に無い列: work_category_id (NOT NULL FK), sla_minutes (>0), effective_from, effective_until, is_active, created_by, version
- (b) migration にあり spec に無い列: store_id, response_deadline_minutes, pickup_deadline_minutes
- (c) なし
- (d) migration=UNIQUE(vendor_id,store_id) vs spec=UNIQUE(company_id,vendor_id,work_category_id) + effective range CHECK
- 影響度: β 以降許容

### 2.6 notification_deliveries
- File: alpha-1-public/13_notifications.sql / Spec: §8.2
- (a) spec にあり migration に無い列: outbox_id (NOT NULL FK), attempt_seq (NOT NULL), provider, result CHECK(sent/failed/bounced/opened/clicked/delivered), error_message, sent_at
- (b) migration にあり spec に無い列: notification_outbox_id, status, error, delivered_at, updated_at
- (c) channel CHECK 欠落 vs spec=CHECK(email/portal/line/sms); result/status 命名違い
- (d) なし
- 影響度: α-3 (β 通知拡張で必須)

### 2.7 vendor_selection_logs
- File: alpha-1-public/12_transport.sql / Spec: §7.11
- (a) spec にあり migration に無い列: selected_vendor_id (NOT NULL), selection_method CHECK(manual/recommended/fallback/auto), selection_reason_note, vendor_snapshot_* fields, considered_vendor_ids (uuid[] NOT NULL DEFAULT '{}')
- (b) migration にあり spec に無い列: invitation_id, vendor_id, score, updated_at
- (c) selection_reason CHECK 欠落 vs spec=CHECK(recommended_top/manual_preference/vendor_unavailable/customer_request/distance_priority/price_priority/other)
- (d) なし
- 影響度: β 以降許容

## §3 High / Low の概要

- vendors: contact_person_name/email/phone, notification_method CHECK 等 8 列追加 + status CHECK 値域違い
- vendor_company_memberships: is_enabled, contract_started_at/ended_at 等 vs migration is_shared/starts_on/ends_on
- vendor_service_areas: area_code 欠落、surrogate id vs 複合 PK
- vendor_available_days: start_at/end_at vs starts_at/ends_at 命名違い + PK 形式違い
- transport_order_status_history: to_status_id/changed_by_user_id/changed_at vs status_id/created_by_user_id/created_at
- transport_order_change_logs: change_type CHECK 等 5 列欠落 vs migration payload jsonb 一本化
- notification_rules: event_type/timing/retry 等 4 列欠落 vs migration event_key/template_key、channel CHECK 欠落
- status_transitions: status_type/required_permission_key/required_role_key/triggers_notification 欠落
- reservation_settings: 12 列欠落 (slot_unit_minutes 等) vs migration store_id 起点 7 列
- attachments: entity_type/entity_id/storage_path/mime_type/size_bytes 欠落 vs migration FK 直結方式
- vendor_available_stores (low): PK 形式 (surrogate vs 複合) — 機能差なし

## §4 反省・原因仮説

- E-2 27/27 緑は trigger 発火を検証したが、列名・意味論は検証外だった
- Sprint α-0 PoC は schema 部分検証のみ（全列 cross-check 未実施）
- spec/audit/audit-coverage.md (2026-05-23) の Tier 1 修正は spec 側のみで migration 側追従が漏れた
- alpha-1-public/*.sql は Phase 8/9 で Codex 委任、spec 完全 cross-check なしで Claude review 通過
- notification_outbox.target_type の意味論逆が D-2 実装中まで気づかれなかった（運用テスト欠如）

## §5 Reconciliation スコープ

- α-2 (5/28-29): critical 7 テーブル + 関連 RLS / audit fixture 再生成
- α-3 (5/30-31): high 残 11 + 業者通知ループ最小実装
- alpha-core 5/31: 条件付き (critical 7 + 業者ループ最小だけで release 判断)

## §6 関連リソース

- spec/data-model.md v2.4 §7-§14
- src/lib/db/raw-migrations/alpha-1-public/*.sql (22 ファイル)
- phase-handoff/phase-13-drift-audit.md (handoff)
- spec/roadmap/roadmap.md v1.2 (reconciliation sprint 切替記録)
---
