-- Phase C-2a: standard trigger set
-- Responsibilities:
--   1) set_updated_at on mutable tables
--   2) status transition validation for reservations / service_tickets / transport_orders
--   3) vendor tenancy enforcement
--   4) vendor_company_memberships shared-registration enforcement
-- Phase C-2b keeps record_audit_log in 23_record_audit_log.sql and is intentionally excluded here.

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.companies;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.company_settings;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.system_settings;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.reservation_settings;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.users;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.user_store_memberships;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.roles;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.permissions;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.statuses;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.status_transitions;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.stores;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.store_business_hours;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.store_holidays;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.lane_types;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.lanes;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.lane_working_hours;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.lane_work_menus;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.work_categories;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.work_menus;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.customers;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vehicles;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vehicle_ownerships;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.customer_reservation_tokens;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.service_tickets;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.reservations;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendors;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_users;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_company_memberships;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_service_areas;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_available_stores;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_available_days;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_sla_overrides;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_selection_logs;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.transport_orders;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.transport_order_change_logs;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.transport_order_vendor_attempts;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.transport_order_invitations;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.notification_rules;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.notification_outbox;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.notification_deliveries;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.vendor_portal_inbox;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.attachments;
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.pii_anonymization_jobs;

DROP TRIGGER IF EXISTS trg_enforce_status_transition ON public.reservations;
DROP TRIGGER IF EXISTS trg_enforce_status_transition ON public.service_tickets;
DROP TRIGGER IF EXISTS trg_enforce_status_transition ON public.transport_orders;

DROP TRIGGER IF EXISTS trg_enforce_vendor_user_tenancy ON public.vendor_users;
DROP TRIGGER IF EXISTS trg_enforce_membership_shared ON public.vendor_company_memberships;

DROP FUNCTION IF EXISTS public.set_updated_at();
DROP FUNCTION IF EXISTS public.enforce_status_transition();
DROP FUNCTION IF EXISTS public.enforce_vendor_user_tenancy();
DROP FUNCTION IF EXISTS public.enforce_membership_shared();
-- sync_user_delete: auth.users trigger 依存のため DROP 不可、CREATE OR REPLACE で更新

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.status_transitions st
      WHERE st.company_id = NEW.company_id
        AND st.from_status_id = OLD.status_id
        AND st.to_status_id = NEW.status_id
    ) THEN
      RAISE EXCEPTION 'invalid status transition: % -> % on %', OLD.status_id, NEW.status_id, TG_TABLE_NAME
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_vendor_user_tenancy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_company_id uuid;
BEGIN
  SELECT v.company_id INTO v_vendor_company_id
  FROM public.vendors v
  WHERE v.id = NEW.vendor_id;

  IF v_vendor_company_id IS NULL THEN
    RAISE EXCEPTION 'vendor_id % does not exist', NEW.vendor_id USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.company_id := v_vendor_company_id;
  ELSIF NEW.company_id IS DISTINCT FROM v_vendor_company_id THEN
    RAISE EXCEPTION 'vendor_users.company_id (%) must match vendors.company_id (%)',
      NEW.company_id, v_vendor_company_id USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_membership_shared()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_shared bool;
  v_owner_company uuid;
BEGIN
  SELECT is_shared, company_id INTO v_is_shared, v_owner_company FROM vendors WHERE id = NEW.vendor_id;

  -- 自社（専属会社）への membership は always OK
  IF v_owner_company = NEW.company_id THEN
    RETURN NEW;
  END IF;

  -- 他社への membership は is_shared=true が必須
  IF NOT v_is_shared THEN
    RAISE EXCEPTION 'Cannot add membership for non-shared vendor';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- auth.users DELETE 時の補助 cleanup (FK の ON DELETE CASCADE / SET NULL で大半カバー)
  -- 現状は NoOp
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.reservation_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.user_store_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.statuses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.status_transitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.store_business_hours
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.store_holidays
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.lane_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.lanes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.lane_working_hours
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.lane_work_menus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.work_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.work_menus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vehicle_ownerships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.customer_reservation_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.service_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_company_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_service_areas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_available_stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_available_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_sla_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_selection_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.transport_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.transport_order_change_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.transport_order_vendor_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.transport_order_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.notification_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.vendor_portal_inbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.attachments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.pii_anonymization_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_enforce_status_transition BEFORE UPDATE OF status_id ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_transition();
CREATE TRIGGER trg_enforce_status_transition BEFORE UPDATE OF status_id ON public.service_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_transition();
CREATE TRIGGER trg_enforce_status_transition BEFORE UPDATE OF status_id ON public.transport_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_transition();

CREATE TRIGGER trg_enforce_vendor_user_tenancy BEFORE INSERT OR UPDATE OF vendor_id, company_id ON public.vendor_users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vendor_user_tenancy();

CREATE TRIGGER trg_enforce_membership_shared BEFORE INSERT OR UPDATE ON public.vendor_company_memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_shared();

-- auth.users DELETE trigger is omitted here because Supabase ownership/privileges prevent
-- straightforward installation from the normal migration path. The helper is kept for Phase D+.

-- defense in depth: sync_user_delete は trigger 専用、RPC 公開しない (advisor WARN 対策)
REVOKE EXECUTE ON FUNCTION public.sync_user_delete() FROM PUBLIC, anon;
