# Sprint α-1 Phase A-1 Codex 委任プロンプト (Draft)

**用途**: 21 DDL ファイル生成のための Codex 委任プロンプト。本ファイルは Codex に渡す本文。
**実行方式**: `/codex:rescue --wait --effort high` または Windows sandbox 制約時は Claude 中継で `codex exec` 直接。
**出力先**: `src/lib/db/raw-migrations/alpha-1-public/` (21 ファイル新規生成)

---

## 役割と目的

あなたは Sprint α-1 Phase A-1 の DDL 移植担当。`pit_v24_poc` schema 内で動作する 21 個の PoC SQL ファイル群を `public` schema 向けに移植し、`spec/data-model.md` v2.4 §3-§13 の差異を全て解消する。

## 出力フォーマット

各ファイルにつき、以下の形で出力:

```
=== FILE: src/lib/db/raw-migrations/alpha-1-public/01_extensions.sql ===
<SQL 本文>
=== END FILE ===

=== FILE: src/lib/db/raw-migrations/alpha-1-public/02_companies.sql ===
<SQL 本文>
=== END FILE ===
...
```

Claude 側で上記マーカーを使って Write ツールで個別ファイル化する。

## 入力資材

| 種別 | パス |
|---|---|
| PoC 元ファイル群 | `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_01_extensions.sql` 〜 `poc12_21_seed_master.sql` |
| PoC #3 派生 (outbox) | `src/lib/db/raw-migrations/poc-3-outbox-skip-locked/poc3_01_alter.sql`, `poc3_02_index.sql` |
| PoC #8 派生 (inbox) | `src/lib/db/raw-migrations/poc-8-inbox-flow/poc8_01_alter.sql` |
| PoC #15 派生 (transport) | `src/lib/db/raw-migrations/poc-15-first-accept-wins/poc15_01_alter.sql`, `poc15_02_index.sql` |
| Spec データモデル | `spec/data-model.md` v2.4 §3-§13, §17 |
| Reconciliation | `phase-handoff/alpha-1-schema-reconciliation.md` (差分突合) |

## マッピング (21 ファイル)

PoC ファイル番号 → 出力ファイル名 (schema 接頭辞 `pit_v24_poc.` を全て削除し、`public.` または無接頭辞に置換):

| # | 出力ファイル | 元 PoC | 主要内容 |
|---|---|---|---|
| 01 | `01_extensions.sql` | poc12_01 | btree_gist / pgcrypto / pg_trgm |
| 02 | `02_companies.sql` | poc12_02 | companies (テナント) |
| 03 | `03_roles_statuses.sql` | poc12_03 | roles 6, lane_types, statuses |
| 04 | `04_auth.sql` | poc12_04 | auth プロファイル / sessions (auth.users 連携) |
| 05 | `05_stores.sql` | poc12_05 | stores / pits / store_users |
| 06 | `06_lanes_work.sql` | poc12_06 | lanes / work_orders / etc |
| 07 | `07_user_memberships.sql` | poc12_07 | user_memberships / vendor_user_memberships |
| 08 | `08_customers_vehicles.sql` | poc12_08 | customers / vehicles |
| 09 | `09_vendors.sql` | poc12_09 | vendors / vendor_users / vendor_lane_capabilities / vendor_available_days |
| 10 | `10_service_tickets.sql` | poc12_10 | service_tickets / etc |
| 11 | `11_reservations.sql` | poc12_11 | reservations (exclusion constraint 完全保持) |
| 12 | `12_transport.sql` | poc12_12 + poc15 | transport_orders 25 列 + movement_type/tow CHECK + version 列 + first-accept index |
| 13 | `13_notifications.sql` | poc12_13 + poc3 + poc8 | notification_outbox + vendor_portal_inbox (**reconciliation Table 1+2 全件反映**) |
| 14 | `14_settings.sql` | poc12_14 | system_settings / company_settings 等 |
| 15 | `15_audit.sql` | poc12_15 | audit_logs (**reconciliation Table 4 反映**) ※ **pii_anonymization_jobs は本ファイルから完全除外** (Phase B-1b Claude 単独実装) |
| 16 | `16_attachments.sql` | poc12_16 | attachments |
| 17 | `17_analytics.sql` | poc12_17 | 3 MATERIALIZED VIEW |
| 18 | `18_helper_functions.sql` | poc12_18 | helper 関数群 (※ Phase B-1a で本実装、ここでは骨組のみ or 空でも可) |
| 19 | `19_rls_policies.sql` | poc12_19 | RLS policies (※ Phase C-1 で本実装、ここでは空 or 最小骨組) |
| 20 | `20_triggers.sql` | poc12_20 | 標準 trigger (※ Phase C-2a で本実装、ここでは空 or 最小骨組) |
| 21 | `21_seed_master.sql` | poc12_21 | seed master (lane_types 6 / statuses 16 / roles 6 / status_transitions / notification_rules) |

**重要**: 18/19/20 (helper/RLS/triggers) と `21_seed_master.sql` のうち実装フェーズが分かれるものは、本 A-1 では「ファイル存在 + コメント "implemented in Phase B/C"」で stub にしてよい。実 DDL は後続 Phase。

ただし以下は A-1 で必ず実装:
- `15_audit.sql` の `REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;` (spec §11.3 line 1311)
- `11_reservations.sql` の exclusion constraint
- `12_transport.sql` の movement_type/tow CHECK (spec §7.6)

## reconciliation 必須反映 (要 Codex 厳守)

### Table 1: `notification_outbox` (13_notifications.sql)

| 列 | 必須補正 |
|---|---|
| `idempotency_key` | text **NOT NULL** UNIQUE (通常 UNIQUE index、partial WHERE 句廃止) |
| `event_type` | text **NOT NULL** |
| `target_type` | text **NOT NULL** CHECK IN ('vendor','customer','store_user') (`IS NULL OR` を削除) |
| `target_id` | uuid **NOT NULL** |
| `invitation_id` → `transport_order_invitation_id` | **RENAME** |
| Index | `CREATE INDEX ix_notification_outbox_pending ON notification_outbox(status, next_attempt_at) WHERE status IN ('pending','failed');` |
| Index | `CREATE INDEX ix_notification_outbox_scheduled ON notification_outbox(scheduled_at) WHERE scheduled_at IS NOT NULL;` |

### Table 2: `vendor_portal_inbox` (13_notifications.sql)

| 列 | 必須補正 |
|---|---|
| `vendor_id` | **NOT NULL** |
| `vendor_user_id` → `recipient_vendor_user_id` | **RENAME** |
| `notification_outbox_id` → `outbox_id` | **RENAME** |
| `subject` → `title` | **RENAME** + **NOT NULL** |
| `body` | **NOT NULL** |
| `transport_order_id` | **ADD** uuid FK |
| `transport_order_invitation_id` | **ADD** uuid FK |
| `severity` | **ADD** text NOT NULL CHECK IN ('info','action_required','urgent') DEFAULT 'info' |
| `archived_at` | **ADD** timestamptz |
| `is_read` | **DROP** (read_at で表現) |
| `updated_at` | **DROP** (spec §8.4 に無し) |
| Index | `CREATE INDEX ix_vendor_portal_inbox_unread ON vendor_portal_inbox(vendor_id, read_at) WHERE archived_at IS NULL;` |

### Table 3: `pii_anonymization_jobs` — **A-1 で作らない**

Phase B-1b で Claude 単独実装。15_audit.sql には**含めないこと**。

### Table 4: `audit_logs` (15_audit.sql)

| 列 | 必須補正 |
|---|---|
| `table_name` → `entity_type` | **RENAME** |
| `entity_id` | **ADD** uuid NOT NULL |
| `action` | **ADD** text NOT NULL CHECK IN ('create','update','delete','restore') |
| `actor_vendor_user_id` | **ADD** uuid NULL FK |
| `actor_kind` | **ADD** text NOT NULL CHECK IN ('user','vendor_user','customer','system') |
| `before_json` | **ADD** jsonb (redacted) |
| `after_json` | **ADD** jsonb (redacted) |
| `ip_address` | **ADD** inet |
| `user_agent` | **ADD** text |
| `payload` | **DROP** (before_json + after_json に分割) |
| `updated_at` | **DROP** (append-only) |
| Index | `CREATE INDEX ix_audit_logs_entity ON audit_logs(entity_type, entity_id);` |
| Index | `CREATE INDEX ix_audit_logs_actor ON audit_logs(actor_user_id, created_at);` |
| GRANT | `REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;` |

## α-2 送り (A-1 で作らない)

- `audit_logs_cleanup_log` テーブル (spec §11.3 line 1315 言及のみで本体定義なし)
- `v_accounting_audit_trail` VIEW (service_tickets 完備依存)
- `pii_anonymization_jobs` テーブル (B-1b で Claude 単独実装)

## schema 接頭辞処理

PoC 全 SQL の `pit_v24_poc.` を全て削除し `public.` に統一 (または無接頭辞)。`auth.users` 等の Supabase 標準 schema 参照は変更しない。

## 出力後の Claude review 観点

Claude は出力を全件受け取った後、以下を check:
1. 21 ファイルが揃っているか
2. RENAME 6 件全て反映されているか
3. NOT NULL 化対象列がすべて NOT NULL になっているか
4. 必須 Index 7 件 (notification_outbox 2 / vendor_portal_inbox 1 / audit_logs 2 + 既存) が CREATE INDEX で含まれているか
5. `15_audit.sql` に `pii_anonymization_jobs` の定義が含まれていないか (含まれていたら除去)
6. `audit_logs_cleanup_log` が含まれていないか
7. `REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;` が `15_audit.sql` 末尾にあるか
8. `11_reservations.sql` の exclusion constraint が完全 WHERE 句保持
9. `12_transport.sql` に movement_type/tow CHECK + version 列 + first-accept index 含む
10. `pit_v24_poc.` 接頭辞が一切残っていないか
