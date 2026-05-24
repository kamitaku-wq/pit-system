-- Phase C-1 RLS policies
-- Scope:
--   Standard tenant-isolation tables (43):
--     companies / company_settings / system_settings / reservation_settings
--     users / user_sessions / user_store_memberships / roles / permissions
--     statuses / status_transitions
--     stores / store_business_hours / store_holidays
--     lane_types / lanes / lane_working_hours / lane_work_menus / work_categories / work_menus
--     customers / vehicles / vehicle_ownerships / customer_reservation_tokens
--     service_tickets / reservations / reservation_status_history
--     vendors / vendor_users / vendor_company_memberships / vendor_service_areas / vendor_available_stores / vendor_available_days / vendor_sla_overrides / vendor_selection_logs
--     transport_order_status_history / transport_order_change_logs / transport_order_vendor_attempts
--     notification_rules / notification_outbox / notification_deliveries
--     attachments / pii_anonymization_jobs
--   Special RLS tables (4):
--     transport_orders / audit_logs / transport_order_invitations / vendor_portal_inbox
-- Notes:
--   - Standard tenant isolation uses public.current_user_company_id().
--   - companies is the only standard table keyed by id, not company_id.
--   - transport_orders has vendor portal SELECT/UPDATE policies plus column-level UPDATE grants.
--   - audit_logs is SELECT-only for authenticated.
--   - vendor_portal_inbox uses dual defense: vendor_id + recipient_vendor_user_id.

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.companies;
CREATE POLICY tenant_isolation ON public.companies
  FOR ALL TO authenticated
  USING (id = public.current_user_company_id())
  WITH CHECK (id = public.current_user_company_id());

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.company_settings;
CREATE POLICY tenant_isolation ON public.company_settings
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- system_settings は system-wide (company scope なし)。authenticated SELECT only、mutation は service_role
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_all_authenticated ON public.system_settings;
CREATE POLICY read_all_authenticated ON public.system_settings
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.system_settings FROM authenticated, anon;

ALTER TABLE public.reservation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.reservation_settings;
CREATE POLICY tenant_isolation ON public.reservation_settings
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.users;
CREATE POLICY tenant_isolation ON public.users
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.user_sessions;
CREATE POLICY tenant_isolation ON public.user_sessions
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.user_store_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.user_store_memberships;
CREATE POLICY tenant_isolation ON public.user_store_memberships
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.roles;
CREATE POLICY tenant_isolation ON public.roles
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.permissions;
CREATE POLICY tenant_isolation ON public.permissions
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.statuses;
CREATE POLICY tenant_isolation ON public.statuses
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.status_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.status_transitions;
CREATE POLICY tenant_isolation ON public.status_transitions
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.stores;
CREATE POLICY tenant_isolation ON public.stores
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.store_business_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.store_business_hours;
CREATE POLICY tenant_isolation ON public.store_business_hours
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.store_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.store_holidays;
CREATE POLICY tenant_isolation ON public.store_holidays
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.lane_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.lane_types;
CREATE POLICY tenant_isolation ON public.lane_types
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.lanes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.lanes;
CREATE POLICY tenant_isolation ON public.lanes
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.lane_working_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.lane_working_hours;
CREATE POLICY tenant_isolation ON public.lane_working_hours
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.lane_work_menus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.lane_work_menus;
CREATE POLICY tenant_isolation ON public.lane_work_menus
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.work_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.work_categories;
CREATE POLICY tenant_isolation ON public.work_categories
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.work_menus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.work_menus;
CREATE POLICY tenant_isolation ON public.work_menus
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.customers;
CREATE POLICY tenant_isolation ON public.customers
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vehicles;
CREATE POLICY tenant_isolation ON public.vehicles
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vehicle_ownerships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vehicle_ownerships;
CREATE POLICY tenant_isolation ON public.vehicle_ownerships
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.customer_reservation_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.customer_reservation_tokens;
CREATE POLICY tenant_isolation ON public.customer_reservation_tokens
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.service_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.service_tickets;
CREATE POLICY tenant_isolation ON public.service_tickets
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.reservations;
CREATE POLICY tenant_isolation ON public.reservations
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.reservation_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.reservation_status_history;
CREATE POLICY tenant_isolation ON public.reservation_status_history
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendors;
CREATE POLICY tenant_isolation ON public.vendors
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_users;
CREATE POLICY tenant_isolation ON public.vendor_users
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_company_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_company_memberships;
CREATE POLICY tenant_isolation ON public.vendor_company_memberships
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_service_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_service_areas;
CREATE POLICY tenant_isolation ON public.vendor_service_areas
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_available_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_available_stores;
CREATE POLICY tenant_isolation ON public.vendor_available_stores
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_available_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_available_days;
CREATE POLICY tenant_isolation ON public.vendor_available_days
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_sla_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_sla_overrides;
CREATE POLICY tenant_isolation ON public.vendor_sla_overrides
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_selection_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_selection_logs;
CREATE POLICY tenant_isolation ON public.vendor_selection_logs
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.transport_order_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transport_order_status_history;
CREATE POLICY tenant_isolation ON public.transport_order_status_history
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.transport_order_change_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transport_order_change_logs;
CREATE POLICY tenant_isolation ON public.transport_order_change_logs
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.transport_order_vendor_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transport_order_vendor_attempts;
CREATE POLICY tenant_isolation ON public.transport_order_vendor_attempts
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notification_rules;
CREATE POLICY tenant_isolation ON public.notification_rules
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notification_outbox;
CREATE POLICY tenant_isolation ON public.notification_outbox
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notification_deliveries;
CREATE POLICY tenant_isolation ON public.notification_deliveries
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.attachments;
CREATE POLICY tenant_isolation ON public.attachments
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.pii_anonymization_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.pii_anonymization_jobs;
CREATE POLICY tenant_select ON public.pii_anonymization_jobs
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

ALTER TABLE public.transport_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transport_orders;
DROP POLICY IF EXISTS vendor_portal_select ON public.transport_orders;
DROP POLICY IF EXISTS vendor_portal_update ON public.transport_orders;
CREATE POLICY tenant_isolation ON public.transport_orders
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY vendor_portal_select ON public.transport_orders
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.vendor_accessible_company_ids(public.current_vendor_id()))
    AND (
      vendor_id = public.current_vendor_id()
      OR id IN (SELECT public.vendor_invited_transport_order_ids(public.current_vendor_id()))
    )
  );
CREATE POLICY vendor_portal_update ON public.transport_orders
  FOR UPDATE TO authenticated
  USING (vendor_id = public.current_vendor_id())
  WITH CHECK (vendor_id = public.current_vendor_id());
REVOKE UPDATE ON public.transport_orders FROM authenticated;
-- spec §14.4 の vendor_response_* / scheduled_*_at / picked_up_at 等は alpha-1 DDL 未実装。
-- 暫定: 既存列で vendor lifecycle update を許可 (Phase 11/α-2 で transport_orders 列追加検討)。
GRANT UPDATE (
  status_id,
  accepted_at,
  completed_at,
  cancelled_at,
  notes,
  version,
  updated_at
) ON public.transport_orders TO authenticated;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.audit_logs;
CREATE POLICY tenant_isolation_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

ALTER TABLE public.transport_order_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transport_order_invitations;
DROP POLICY IF EXISTS vendor_select ON public.transport_order_invitations;
CREATE POLICY tenant_isolation ON public.transport_order_invitations
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY vendor_select ON public.transport_order_invitations
  FOR SELECT TO authenticated
  USING (vendor_id = public.current_vendor_id());

ALTER TABLE public.vendor_portal_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_portal_inbox;
DROP POLICY IF EXISTS vendor_portal_inbox_select ON public.vendor_portal_inbox;
CREATE POLICY tenant_isolation ON public.vendor_portal_inbox
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY vendor_portal_inbox_select ON public.vendor_portal_inbox
  FOR SELECT TO authenticated
  USING (
    vendor_id = public.current_vendor_id()
    AND (
      recipient_vendor_user_id IS NULL
      OR recipient_vendor_user_id = public.current_vendor_user_id()
    )
  );

REVOKE EXECUTE ON FUNCTION public.current_user_company_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_vendor_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_vendor_user_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.vendor_accessible_company_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_invitation_and_revoke_others(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redact_audit_payload(text, jsonb) FROM PUBLIC, anon;

REVOKE SELECT ON public.lane_utilization_daily FROM anon, authenticated;
REVOKE SELECT ON public.vendor_response_kpi_daily FROM anon, authenticated;
REVOKE SELECT ON public.notification_delivery_kpi_daily FROM anon, authenticated;
