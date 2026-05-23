CREATE FUNCTION pit_v24_poc.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pit_v24_poc AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION pit_v24_poc.validate_status_transition()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pit_v24_poc AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE FUNCTION pit_v24_poc.sync_vendor_user_company_id()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pit_v24_poc AS $$
BEGIN
  SELECT pit_v24_poc.vendors.company_id
  INTO NEW.company_id
  FROM pit_v24_poc.vendors
  WHERE pit_v24_poc.vendors.id = NEW.vendor_id;

  RETURN NEW;
END;
$$;

CREATE FUNCTION pit_v24_poc.validate_vendor_company_membership()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pit_v24_poc AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE FUNCTION pit_v24_poc.record_audit_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pit_v24_poc AS $$
DECLARE
  audit_payload jsonb;
  audit_company_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    audit_payload := to_jsonb(OLD);
  ELSE
    audit_payload := to_jsonb(NEW);
  END IF;

  audit_company_id := (audit_payload ->> 'company_id')::uuid;

  IF audit_company_id IS NOT NULL THEN
    INSERT INTO pit_v24_poc.audit_logs (company_id, table_name, payload)
    VALUES (audit_company_id, TG_TABLE_NAME, pit_v24_poc.redact_audit_payload(audit_payload));
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.companies FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.roles FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.permissions FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.statuses FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.status_transitions FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.users FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.stores FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.store_business_hours FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.store_holidays FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.lane_types FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.lanes FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.lane_working_hours FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.work_categories FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.work_menus FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.lane_work_menus FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.user_store_memberships FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.customers FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vehicles FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vehicle_ownerships FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendors FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendor_users FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendor_company_memberships FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendor_service_areas FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendor_available_stores FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendor_available_days FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.service_tickets FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.reservations FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.reservation_status_history FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.customer_reservation_tokens FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.transport_orders FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.transport_order_status_history FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.transport_order_change_logs FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.transport_order_vendor_attempts FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.transport_order_invitations FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendor_selection_logs FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.notification_rules FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.notification_outbox FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.notification_deliveries FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.vendor_portal_inbox FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.reservation_settings FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.audit_logs FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pit_v24_poc.attachments FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.set_updated_at();

CREATE TRIGGER validate_status_transition BEFORE INSERT OR UPDATE ON pit_v24_poc.reservation_status_history FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.validate_status_transition();
CREATE TRIGGER validate_status_transition BEFORE INSERT OR UPDATE ON pit_v24_poc.transport_order_status_history FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.validate_status_transition();
CREATE TRIGGER sync_vendor_user_company_id BEFORE INSERT OR UPDATE OF vendor_id ON pit_v24_poc.vendor_users FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.sync_vendor_user_company_id();
CREATE TRIGGER validate_vendor_company_membership BEFORE INSERT OR UPDATE ON pit_v24_poc.vendor_company_memberships FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.validate_vendor_company_membership();

CREATE TRIGGER record_audit_log AFTER INSERT OR UPDATE OR DELETE ON pit_v24_poc.users FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.record_audit_log();
CREATE TRIGGER record_audit_log AFTER INSERT OR UPDATE OR DELETE ON pit_v24_poc.customers FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.record_audit_log();
CREATE TRIGGER record_audit_log AFTER INSERT OR UPDATE OR DELETE ON pit_v24_poc.vehicles FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.record_audit_log();
CREATE TRIGGER record_audit_log AFTER INSERT OR UPDATE OR DELETE ON pit_v24_poc.vendors FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.record_audit_log();
CREATE TRIGGER record_audit_log AFTER INSERT OR UPDATE OR DELETE ON pit_v24_poc.service_tickets FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.record_audit_log();
CREATE TRIGGER record_audit_log AFTER INSERT OR UPDATE OR DELETE ON pit_v24_poc.reservations FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.record_audit_log();
CREATE TRIGGER record_audit_log AFTER INSERT OR UPDATE OR DELETE ON pit_v24_poc.transport_orders FOR EACH ROW EXECUTE FUNCTION pit_v24_poc.record_audit_log();
