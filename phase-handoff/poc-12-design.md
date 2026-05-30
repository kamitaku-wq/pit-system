# PoC #12 Design Memo — migration §17 順序 (Claude 設計)

> 本書は Codex 委任 prompt の根拠 + 検証手順の同期ファイル。Phase seal 用 handoff より詳細だが、永続文書ではない (PoC 完了後 phase-handoff/phase-5-* に統合)。

## 0. PoC 完了基準 (spec/roadmap §1.2)

- §17 定義順 (01→21) で空 DB に full apply → migration エラー 0 件
- 全テーブル作成確認 (count ≥ 30)
- v2.3 修正の意図 (helper → RLS → trigger) が空 DB で fail しないこと

## 1. 検証戦略 (Schema 隔離 fallback)

`mcp__supabase__create_branch` は `Project reference is missing when validating permissions` で permission エラー → schema 隔離 fallback。

**`pit_v24_poc` schema 内で §17 完全再現**:
- 既存 `public.{companies,users,vendor_users,vendors,_reservations_slice_test,_version_test}` は触らない
- 全 DDL は `pit_v24_poc.<table>` 形式で schema prefix
- helper も `pit_v24_poc.current_user_company_id()` 等で隔離
- 検証完了後 `DROP SCHEMA pit_v24_poc CASCADE` で clean up

検証強度の制約 (handoff 記録対象):
- `auth.uid()` / `auth.users` は global schema → helper 関数の本物動作確認は不可。callable + 構文 OK までを検証
- `extensions` (btree_gist / pgcrypto) は global なので CREATE EXTENSION IF NOT EXISTS のみ
- public 既存 stub の干渉はゼロだが、`auth.*` 起因の検証は α-1 で再実施

## 2. 既存実装の衝突マップ

| 既存 path | 内容 | 衝突 |
|---|---|---|
| `src/lib/db/migrations/0000_*.sql` (Drizzle) | public.{companies,users,vendor_users} + 2 FK | なし (public 限定) |
| `src/lib/db/raw-migrations/pre/0001_extensions.sql` | btree_gist, pgcrypto | なし (CREATE EXTENSION IF NOT EXISTS) |
| `src/lib/db/raw-migrations/post/0002_helpers.sql` | 4 関数 (set_updated_at + helper 3 種) | なし (schema prefix 分離) |
| `src/lib/db/raw-migrations/post/0003_triggers.sql` | updated_at trigger × 3 | なし |
| `src/lib/db/raw-migrations/post/0004_rls.sql` | RLS policy × 7 | なし |
| `src/lib/db/raw-migrations/post/0005_reservations_slice_test.sql` | public._reservations_slice_test | なし |
| public.vendors (PoC #1 が ALTER で追加) | RLS policy 2 種付き | なし |

## 3. ファイル配置

`src/lib/db/raw-migrations/poc-12-schema-isolation/` に 21 ファイル + 1 cleanup:

```
poc12_00_schema_init.sql        CREATE SCHEMA pit_v24_poc;
poc12_01_extensions.sql         (グローバル EXTENSION のみ確認 / IF NOT EXISTS)
poc12_02_companies.sql
poc12_03_roles_statuses.sql     roles, permissions, statuses, status_transitions
poc12_04_auth.sql               users (FK: roles, companies), 注: vendor_users は 09 後
poc12_05_stores.sql
poc12_06_lanes_work.sql         lane_types, lanes, lane_working_hours, work_categories, work_menus, lane_work_menus
poc12_07_user_memberships.sql   user_store_memberships
poc12_08_customers_vehicles.sql
poc12_09_vendors.sql            vendors, vendor_users, vendor_company_memberships, vendor_service_areas, vendor_available_stores, vendor_available_days
poc12_10_service_tickets.sql
poc12_11_reservations.sql       reservations + EXCLUSION CONSTRAINT + reservation_status_history + customer_reservation_tokens FK ALTER
poc12_12_transport.sql          transport_orders + CHECK + history + change_logs + vendor_attempts + invitations + vendor_selection_logs
poc12_13_notifications.sql      notification_rules, notification_outbox, notification_deliveries, vendor_portal_inbox
poc12_14_settings.sql           reservation_settings
poc12_15_audit.sql              audit_logs
poc12_16_attachments.sql        attachments
poc12_17_analytics.sql          lane_utilization_daily (MV), vendor_response_kpi_daily (MV)
poc12_18_helper_functions.sql   current_user_company_id, current_vendor_id, current_vendor_user_id, vendor_accessible_company_ids, vendor_invited_transport_order_ids, redact_audit_payload, accept_invitation_and_revoke_others
poc12_19_rls_policies.sql       全テーブル ALTER ENABLE RLS + tenant_isolation policy
poc12_20_triggers.sql           updated_at trigger + status_transition validation + vendor_user 同期 + is_shared CHECK + audit_logs 自動記録
poc12_21_seed_master.sql        lane_types, statuses, status_transitions, notification_rules, roles seed
poc12_99_cleanup.sql            (手動 apply 用、_raw_migrations 履歴削除 + DROP SCHEMA pit_v24_poc CASCADE)
```

## 4. 骨格 DDL スコープ (advisor 強調)

- **最小列のみ**: `id uuid PK DEFAULT gen_random_uuid()`, `company_id uuid NOT NULL`, 主要 FK, `created_at/updated_at timestamptz DEFAULT now()`, `deleted_at timestamptz`
- 全列展開・CHECK 制約・複雑な UNIQUE は α-1 (PoC 外)
- 4 方向 RLS (SELECT/INSERT/UPDATE/DELETE) はスコープ外、SELECT tenant_isolation 1 種だけ
- seed は 1-2 行のサンプルのみ (full master data は α-1)

## 5. 検証 SQL (advisor 提案 4 種 + 補強)

`pit_v24_poc` schema 隔離前提:

```sql
-- 5.1 テーブル数 (期待: ≥ 30)
SELECT count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'pit_v24_poc' AND table_type = 'BASE TABLE';

-- 5.2 FK 数 (期待: ≥ 40)
SELECT count(*) AS fk_count
FROM information_schema.table_constraints
WHERE table_schema = 'pit_v24_poc' AND constraint_type = 'FOREIGN KEY';

-- 5.3 主要テーブル RLS 有効 (期待: 5 件 true)
SELECT relname, relrowsecurity
FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'pit_v24_poc'
  AND relname IN ('companies','users','vendors','reservations','transport_orders')
ORDER BY relname;

-- 5.4 helper 関数 5+ 種存在 (期待: 5 件以上、redact_audit_payload 必須)
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'pit_v24_poc'
ORDER BY p.proname;

-- 5.5 EXCLUSION CONSTRAINT (reservations の §6 排他) 存在
SELECT conname FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
JOIN pg_namespace n ON t.relnamespace = n.oid
WHERE n.nspname = 'pit_v24_poc' AND t.relname = 'reservations' AND c.contype = 'x';

-- 5.6 §17 順序 fail パターン回避確認: helper 関数を RLS policy 内で参照しているか
-- (sample) reservations の policy USING 句に current_user_company_id() が含まれる
SELECT pg_get_expr(qual, polrelid) AS rls_using
FROM pg_policy WHERE polrelid = 'pit_v24_poc.reservations'::regclass;
```

## 6. apply 手順

```bash
# 1. PoC dir 用に apply-raw-sql.ts を流す
pnpm exec tsx src/lib/db/apply-raw-sql.ts ./src/lib/db/raw-migrations/poc-12-schema-isolation

# 2. 検証 SQL を MCP execute_sql で 6 件実行 → 結果を本書 §5 expectation と比較

# 3. PoC 終了後 cleanup
# psql で poc12_99_cleanup.sql 手動 apply、または MCP で:
#   DROP SCHEMA pit_v24_poc CASCADE;
#   DELETE FROM public._raw_migrations WHERE filename LIKE 'poc12_%';
```

## 7. Codex 委任スコープ (1 タスク)

委任先: `Task(codex:codex-rescue)` --effort high
生成ファイル: `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_00_schema_init.sql` ～ `poc12_21_seed_master.sql` + `poc12_99_cleanup.sql` (合計 23 ファイル)

prompt 必須事項:
- 全 DDL は `pit_v24_poc.<table>` schema prefix
- 「最小列のみ (id, company_id, FK, timestamps)」を 3 回繰り返し強調
- spec/data-model.md §17 を Read 推奨 (Codex は MCP supabase で execute_sql 不可、ファイル参照のみ)
- 検証フェーズは Claude 側で MCP 経由実行のため、Codex は SQL ファイル生成のみ

Claude 側レビュー基準:
- §17 順序の階層が崩れていない (FK 依存解決順)
- helper → RLS → trigger 順 (v2.3 修正の意図)
- schema prefix 漏れなし (grep で `^CREATE TABLE [^p]` のヒットがゼロ)
- 列数膨張なし (各 CREATE TABLE が 8 列以下、advisor 強調の minimal 担保)
