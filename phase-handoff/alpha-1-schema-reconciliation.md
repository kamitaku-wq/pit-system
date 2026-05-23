# Sprint α-1 Schema Reconciliation Checklist

**目的**: A-1 (DDL 21 ファイル Codex 委任) 着手前に、PoC 残置 schema (`pit_v24_poc`) と spec §3-§13 の差異を全列突合し、本実装 (`public`) 移植時の必須補正を確定する。Codex review #B.7 / #D.3 / #E.6 反映。
**スコープ**: notification_outbox / vendor_portal_inbox / pii_anonymization_jobs / audit_logs の 4 テーブル (Codex 委任の高 stake 対象)
**根拠 spec**: data-model.md §8.1 / §8.4 / §11.1 / §11.2b

---

## Table 1: `notification_outbox` (spec §8.1, lines 997-1023)

PoC: poc12_13 base (6 列) + poc3 ALTER (13 列追加 + UNIQUE)

| 列 | spec | PoC 現状 | 必須補正 |
|---|---|---|---|
| `idempotency_key` | text **NOT NULL** UNIQUE | text (nullable) + partial UNIQUE WHERE NOT NULL | **NOT NULL 化** + 通常 UNIQUE index に置換 |
| `event_type` | text NOT NULL | text (nullable) | **NOT NULL 化** |
| `target_type` | text NOT NULL CHECK ('vendor','customer','store_user') | nullable + CHECK `IS NULL OR ...` | **NOT NULL 化** + CHECK 簡素化 |
| `target_id` | uuid NOT NULL | nullable | **NOT NULL 化** |
| `transport_order_invitation_id` | spec 列名 | PoC 列名 `invitation_id` | **列名 RENAME**: `invitation_id` → `transport_order_invitation_id` |
| `payload` | jsonb NOT NULL | jsonb DEFAULT '{}' | OK (DEFAULT は不要、spec は明示 DEFAULT なし) |
| Index 1 | `(status, next_attempt_at) WHERE status IN ('pending','failed')` | 未作成 | **追加必須** |
| Index 2 | `(scheduled_at) WHERE scheduled_at IS NOT NULL` | 未作成 | **追加必須** |

✅ 既に整合: id / company_id / status CHECK / attempts / max_attempts / next_attempt_at / sent_at / last_error / scheduled_at / processing_started_at / created_at / updated_at

---

## Table 2: `vendor_portal_inbox` (spec §8.4, lines 1087-1107)

PoC: poc12_13 base (6 列) + poc8 ALTER (4 列)

| 列 | spec | PoC 現状 | 必須補正 |
|---|---|---|---|
| `vendor_id` | uuid **NOT NULL** FK | nullable | **NOT NULL 化** |
| `recipient_vendor_user_id` | uuid NULL FK | 列名 `vendor_user_id` | **列名 RENAME**: `vendor_user_id` → `recipient_vendor_user_id` |
| `outbox_id` | uuid FK | 列名 `notification_outbox_id` | **列名 RENAME**: `notification_outbox_id` → `outbox_id` |
| `transport_order_id` | uuid FK | 列なし | **列追加** |
| `transport_order_invitation_id` | uuid FK | 列なし | **列追加** |
| `title` | text **NOT NULL** | poc8 `subject` (nullable) | **列名 RENAME + NOT NULL 化**: `subject` → `title` |
| `body` | text **NOT NULL** | nullable | **NOT NULL 化** |
| `severity` | text NOT NULL CHECK ('info','action_required','urgent') DEFAULT 'info' | 列なし | **列追加** |
| `read_at` | timestamptz | ✅ poc8 で追加済 | OK |
| `archived_at` | timestamptz | 列なし | **列追加** |
| `is_read` (PoC 残置) | spec に無い | poc8 boolean DEFAULT false | **DROP**: spec は read_at の NULL/NOT NULL で表現 |
| `updated_at` (PoC 残置) | spec に無い | poc12 で追加 | **DROP** (spec の §8.4 には updated_at なし) |
| Index | `(vendor_id, read_at) WHERE archived_at IS NULL` | 未作成 | **追加必須** |

---

## Table 3: `pii_anonymization_jobs` (spec §11.2b, lines 1259-1287) — **新規テーブル**

PoC: 存在しない (audit と分離して poc12_15 は audit_logs のみ)

**全列 + 制約 + index を新規作成必須**:

| 要素 | spec 定義 |
|---|---|
| 列 (15) | id uuid PK / company_id uuid NOT NULL FK ON DELETE CASCADE / customer_id uuid NOT NULL FK ON DELETE CASCADE / anonymized_customer_key uuid NOT NULL DEFAULT gen_random_uuid() / requested_at timestamptz NOT NULL / verified_at timestamptz NULL / scheduled_for timestamptz NOT NULL / processed_at timestamptz NULL / status text NOT NULL CHECK (7 値) / failure_reason text NULL / legal_hold_reason text NULL / retry_count int NOT NULL DEFAULT 0 / created_at / updated_at / version int NOT NULL DEFAULT 1 |
| status enum | `'pending','verified','scheduled','processing','completed','failed','legal_hold'` (7 値、state machine) |
| EXCLUDE constraint | `EXCLUDE USING btree (customer_id WITH =) WHERE (status IN ('pending','verified','scheduled','processing'))` — 同一 customer_id の同時 active job を禁止 |
| Index 1 | `(scheduled_for, status) WHERE status IN ('pending','verified','scheduled')` (Inngest pickup 用) |
| Index 2 | `(anonymized_customer_key)` |
| View | `v_accounting_audit_trail` (JOIN service_tickets、匿名化後参照用) |

**Codex review #C.2 / #D.2 / #E.4 指摘**: state machine として全列 + EXCLUDE semantics が定義済。**Claude 単独実装** (Codex 委任不可)。

---

## Table 4: `audit_logs` (spec §11.1, lines 1191-1210)

PoC: poc12_15 base (6 列、`table_name` + `payload` のみ)

| 列 | spec | PoC 現状 | 必須補正 |
|---|---|---|---|
| `entity_type` | text NOT NULL | 列名 `table_name` | **列名 RENAME + 意味調整**: `table_name` → `entity_type` |
| `entity_id` | uuid NOT NULL | 列なし | **列追加** |
| `action` | text NOT NULL CHECK ('create','update','delete','restore') | 列なし | **列追加** |
| `actor_user_id` | uuid NULL FK | ✅ | OK |
| `actor_vendor_user_id` | uuid NULL FK | 列なし | **列追加** |
| `actor_kind` | text NOT NULL CHECK ('user','vendor_user','customer','system') | 列なし | **列追加** |
| `before_json` | jsonb (redacted) | 列なし (poc に `payload` 1 列) | **列追加** + `payload` 削除 |
| `after_json` | jsonb (redacted) | 列なし | **列追加** |
| `ip_address` | inet | 列なし | **列追加** |
| `user_agent` | text | 列なし | **列追加** |
| `updated_at` (PoC 残置) | spec に無い | poc12 で追加 | **DROP** (append-only テーブル、updated_at 不要) |
| Index 1 | `(entity_type, entity_id)` | 未作成 | **追加必須** |
| Index 2 | `(actor_user_id, created_at)` | 未作成 | **追加必須** |
| GRANT | `REVOKE UPDATE, DELETE FROM authenticated, anon;` (§11.3 line 1311) | 未設定 | **必須 GRANT 設定** |

---

## Table 5: `audit_logs_cleanup_log` (spec [1315] 言及のみ、本体定義なし)

**spec status**: §11.3 で「クリーンアップは ... `audit_logs_cleanup_log` テーブルに削除実績を別記録」とあるが、テーブル定義が spec に存在しない。Codex review #B.4 指摘。

**判断 (要ユーザー確認)**: α-1 で以下のどちらか:
- (A) **暫定構造で先行作成**: `id / company_id / deleted_count / deleted_from / deleted_to / executed_at / executed_by` 程度の最小構造で Phase A に追加。spec TODO として記録
- (B) **α-2 送り**: §11.3 cleanup cron 自体が α-1 スコープ外 (roadmap.md §1.3 確認必要)、cleanup_log も α-2 に延ばす

---

## Phase A への影響まとめ

### A-1 (Codex 委任) 修正必要箇所
1. `13_notifications.sql`: notification_outbox の 4 列 NOT NULL 化 + `invitation_id` → `transport_order_invitation_id` rename + 2 spec 必須 index
2. `13_notifications.sql`: vendor_portal_inbox の 5 列 RENAME + 3 列 ADD + 2 列 DROP + 1 spec 必須 index
3. `15_audit.sql`: audit_logs の 9 列追加/RENAME + payload DROP + updated_at DROP + 2 index + REVOKE GRANT
4. `15_audit.sql`: pii_anonymization_jobs 全 15 列 + EXCLUDE + 2 index + v_accounting_audit_trail VIEW を**新規作成**

### Claude 単独実装に移動 (Codex 委任不可)
- pii_anonymization_jobs state machine (Codex review #E.4)
- audit_logs 関連の record_audit_log trigger (Codex review #E.2)

### Codex 委任時に明示指示すべき列名差異 (RENAME 6 件)
- `notification_outbox.invitation_id` → `transport_order_invitation_id`
- `vendor_portal_inbox.vendor_user_id` → `recipient_vendor_user_id`
- `vendor_portal_inbox.notification_outbox_id` → `outbox_id`
- `vendor_portal_inbox.subject` → `title`
- `audit_logs.table_name` → `entity_type`
- `audit_logs.payload` → `before_json` + `after_json` 分割

### α-2 送り候補
- `audit_logs_cleanup_log` (上記判断 (B) 採用時)
- v_accounting_audit_trail VIEW (service_tickets が α-1 で完備されるなら作る、未確定なら α-2)

---

*Compiled from spec/data-model.md v2.4 + PoC poc12/poc3/poc8 actuals*
