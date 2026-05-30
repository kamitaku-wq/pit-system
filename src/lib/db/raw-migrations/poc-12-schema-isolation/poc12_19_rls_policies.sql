ALTER TABLE pit_v24_poc.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.companies FOR SELECT USING (id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.roles FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.permissions FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.statuses FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.status_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.status_transitions FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.users FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.stores FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.store_business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.store_business_hours FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.store_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.store_holidays FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.lane_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.lane_types FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.lanes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.lanes FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.lane_working_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.lane_working_hours FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.work_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.work_categories FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.work_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.work_menus FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.lane_work_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.lane_work_menus FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.user_store_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.user_store_memberships FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.customers FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vehicles FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vehicle_ownerships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vehicle_ownerships FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendors FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendor_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendor_users FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendor_company_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendor_company_memberships FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendor_service_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendor_service_areas FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendor_available_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendor_available_stores FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendor_available_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendor_available_days FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.service_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.service_tickets FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.reservations FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.reservation_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.reservation_status_history FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.customer_reservation_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.customer_reservation_tokens FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.transport_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.transport_orders FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.transport_order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.transport_order_status_history FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.transport_order_change_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.transport_order_change_logs FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.transport_order_vendor_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.transport_order_vendor_attempts FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.transport_order_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.transport_order_invitations FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendor_selection_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendor_selection_logs FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.notification_rules FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.notification_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.notification_outbox FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.notification_deliveries FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.vendor_portal_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.vendor_portal_inbox FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.reservation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.reservation_settings FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.audit_logs FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());

ALTER TABLE pit_v24_poc.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pit_v24_poc.attachments FOR SELECT USING (company_id = pit_v24_poc.current_user_company_id());
