# Phase C-1: RLS policies 全 47 テーブル (Codex 委任)

## ゴール

既存ファイル `src/lib/db/raw-migrations/alpha-1-public/19_rls_policies.sql` (現状 stub `-- implemented in Phase C-1`) を **完全置換** して 47 テーブルの RLS policies を実装。

## 47 テーブル (Phase B-2 で apply 済 + pii_anonymization_jobs 含む)

社内テナント分離標準 (43 テーブル):
- companies / company_settings / system_settings / reservation_settings
- users / user_sessions / user_store_memberships / roles / permissions
- statuses / status_transitions
- stores / store_business_hours / store_holidays
- lane_types / lanes / lane_working_hours / lane_work_menus / work_categories / work_menus
- customers / vehicles / vehicle_ownerships / customer_reservation_tokens
- service_tickets / reservations / reservation_status_history
- vendors / vendor_users / vendor_company_memberships / vendor_service_areas / vendor_available_stores / vendor_available_days / vendor_sla_overrides / vendor_selection_logs
- transport_order_status_history / transport_order_change_logs / transport_order_vendor_attempts
- notification_rules / notification_outbox / notification_deliveries / vendor_portal_inbox
- attachments
- pii_anonymization_jobs (B-1b で追加)

特殊 RLS (4 テーブル):
- transport_orders: vendor_portal_select / vendor_portal_update (column-level grant)
- audit_logs: tenant SELECT only (REVOKE UPDATE/DELETE は 15_audit.sql で済)
- transport_order_invitations: 標準 + vendor_user SELECT (招待先業者の閲覧)
- vendor_portal_inbox: 二重防衛 (vendor_id + recipient_vendor_user_id)

## 標準 RLS パターン (spec §14.3)

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.<table>
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
```

`companies` のみ例外 (自テーブルが company なので id 比較):
```sql
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.companies
  FOR ALL TO authenticated
  USING (id = public.current_user_company_id())
  WITH CHECK (id = public.current_user_company_id());
```

## 特殊 RLS (spec §14.4)

### transport_orders (vendor_portal access)

```sql
ALTER TABLE public.transport_orders ENABLE ROW LEVEL SECURITY;

-- 社内ユーザー: 標準 tenant_isolation
CREATE POLICY tenant_isolation ON public.transport_orders
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- 業者ユーザー: SELECT 可能 (アクセス可 company + 自社 vendor or 招待先)
CREATE POLICY vendor_portal_select ON public.transport_orders
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.vendor_accessible_company_ids(public.current_vendor_id()))
    AND (
      vendor_id = public.current_vendor_id()
      OR id IN (SELECT public.vendor_invited_transport_order_ids(public.current_vendor_id()))
    )
  );

-- 業者ユーザー: UPDATE は自社 vendor のみ。列はホワイトリスト
CREATE POLICY vendor_portal_update ON public.transport_orders
  FOR UPDATE TO authenticated
  USING (vendor_id = public.current_vendor_id())
  WITH CHECK (vendor_id = public.current_vendor_id());

REVOKE UPDATE ON public.transport_orders FROM authenticated;
GRANT UPDATE (vendor_response, vendor_response_at, vendor_rejection_reason,
              scheduled_pickup_at, scheduled_delivery_at, scheduled_return_at,
              picked_up_at, delivered_at, returned_at, status_id, version, updated_at)
  ON public.transport_orders TO authenticated;
```

### audit_logs (SELECT only)

```sql
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());
-- INSERT は record_audit_log trigger (SECURITY DEFINER) 経由のみ。
-- REVOKE UPDATE, DELETE は 15_audit.sql で設定済。
```

### pii_anonymization_jobs (service_role-only mutation)

```sql
ALTER TABLE public.pii_anonymization_jobs ENABLE ROW LEVEL SECURITY;

-- authenticated は SELECT のみ
CREATE POLICY tenant_select ON public.pii_anonymization_jobs
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

-- service_role (Inngest worker) は全権限。RLS bypass は service_role 標準動作
-- (PostgREST default では service_role が RLS bypass)
REVOKE UPDATE, DELETE ON public.pii_anonymization_jobs FROM authenticated;
```

### vendor_portal_inbox (二重防衛, Codex review #B.6)

```sql
ALTER TABLE public.vendor_portal_inbox ENABLE ROW LEVEL SECURITY;

-- 社内: 標準
CREATE POLICY tenant_isolation ON public.vendor_portal_inbox
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- 業者ユーザー: 自社 vendor + (個人宛 OR 全員宛) を SELECT
CREATE POLICY vendor_portal_inbox_select ON public.vendor_portal_inbox
  FOR SELECT TO authenticated
  USING (
    vendor_id = public.current_vendor_id()
    AND (recipient_vendor_user_id IS NULL OR recipient_vendor_user_id = public.current_vendor_user_id())
  );
```

### transport_order_invitations (vendor SELECT 追加)

```sql
ALTER TABLE public.transport_order_invitations ENABLE ROW LEVEL SECURITY;

-- 社内: 標準
CREATE POLICY tenant_isolation ON public.transport_order_invitations
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- 業者: 自社 vendor 宛招待を SELECT
CREATE POLICY vendor_select ON public.transport_order_invitations
  FOR SELECT TO authenticated
  USING (vendor_id = public.current_vendor_id());
```

## ファイル末尾: SECURITY DEFINER 関数の REVOKE FROM anon (Phase B-2 advisor 指摘)

```sql
-- defense in depth: anon は呼び出せない
REVOKE EXECUTE ON FUNCTION public.current_user_company_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_vendor_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_vendor_user_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.vendor_accessible_company_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_invitation_and_revoke_others(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redact_audit_payload(text, jsonb) FROM PUBLIC, anon;
```

## materialized views (Phase B-2 advisor 指摘): authenticated REVOKE

```sql
REVOKE SELECT ON public.lane_utilization_daily FROM anon, authenticated;
REVOKE SELECT ON public.vendor_response_kpi_daily FROM anon, authenticated;
REVOKE SELECT ON public.notification_delivery_kpi_daily FROM anon, authenticated;
-- service_role 経由のみ集計参照
```

## 出力要件

1. ファイル全体を **CREATE OR REPLACE / DROP IF EXISTS で冪等化しない** (apply 1 回限り想定)
   - 既存 policy がある場合は `DROP POLICY IF EXISTS ... ON ...;` を各 CREATE POLICY 前に追加
2. 43 標準テーブル + 4 特殊 + REVOKE 関数 7 + REVOKE matviews 3 を網羅
3. ファイル先頭にコメント (テーブル一覧 / 特殊 RLS 注意点)
4. 完了行数: ~200-240 行見込み
5. typecheck / pnpm 実行はしない

## 禁止事項

- spec §14.2 サンプル SQL を盲信せず、Phase B-1a helper 7 関数を使う (auth_user_id 経由)
- companies の policy だけは `id = current_user_company_id()` (他は company_id)
- DROP POLICY IF EXISTS を忘れず冪等化 (再 apply 時の二重定義防止)

## 完了確認

- 47 ALTER TABLE ... ENABLE ROW LEVEL SECURITY
- 47+ CREATE POLICY (特殊テーブルは複数)
- transport_orders 列レベル GRANT
- 7 関数 REVOKE FROM anon
- 3 matviews REVOKE FROM anon, authenticated
