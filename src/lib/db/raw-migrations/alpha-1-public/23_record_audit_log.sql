-- Phase C-2b: record_audit_log trigger (Critical, Claude 単独)
-- spec/data-model.md §11.1 §11.2 §15.9 / Plan §C-2b
-- 9 audited tables: users / customers / vehicles / vendors / vendor_users /
--                   service_tickets / reservations / transport_orders / transport_order_invitations
-- 必須要件: pg_trigger_depth() recursion 防止 / audit_logs 自己監査回避 /
--            redact_audit_payload 経由 / deleted_at 列なし 2 件 jsonb-key 安全分岐 /
--            actor 解決 (users → vendor_users → 'system')

CREATE OR REPLACE FUNCTION public.record_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entity_type text := TG_TABLE_NAME;
  v_action text;
  v_company_id uuid;
  v_actor_user_id uuid;
  v_actor_vendor_user_id uuid;
  v_actor_kind text := 'system';
  v_before jsonb;
  v_after jsonb;
  v_old_jsonb jsonb;
  v_new_jsonb jsonb;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- NEW/OLD IS NOT NULL は ROW 全列 NOT NULL の時のみ TRUE (SQL 標準) → TG_OP で分岐
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_jsonb := to_jsonb(NEW); END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_jsonb := to_jsonb(OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_before := NULL;
    v_after := v_new_jsonb;
    v_company_id := (v_new_jsonb->>'company_id')::uuid;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    IF v_new_jsonb ? 'deleted_at' THEN
      IF (v_new_jsonb->>'deleted_at') IS NOT NULL AND (v_old_jsonb->>'deleted_at') IS NULL THEN
        v_action := 'delete';
      ELSIF (v_new_jsonb->>'deleted_at') IS NULL AND (v_old_jsonb->>'deleted_at') IS NOT NULL THEN
        v_action := 'restore';
      END IF;
    END IF;
    v_before := v_old_jsonb;
    v_after := v_new_jsonb;
    v_company_id := (v_new_jsonb->>'company_id')::uuid;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_before := v_old_jsonb;
    v_after := NULL;
    v_company_id := (v_old_jsonb->>'company_id')::uuid;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_actor_user_id FROM public.users
      WHERE id = auth.uid() AND deleted_at IS NULL LIMIT 1;
    IF v_actor_user_id IS NOT NULL THEN v_actor_kind := 'user';
    ELSE
      SELECT id INTO v_actor_vendor_user_id FROM public.vendor_users
        WHERE auth_user_id = auth.uid() AND is_active = true AND deleted_at IS NULL LIMIT 1;
      IF v_actor_vendor_user_id IS NOT NULL THEN v_actor_kind := 'vendor_user'; END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    company_id, entity_type, entity_id, action,
    actor_user_id, actor_vendor_user_id, actor_kind,
    before_json, after_json
  ) VALUES (
    v_company_id, v_entity_type,
    COALESCE((v_new_jsonb->>'id')::uuid, (v_old_jsonb->>'id')::uuid),
    v_action, v_actor_user_id, v_actor_vendor_user_id, v_actor_kind,
    public.redact_audit_payload(v_entity_type, v_before),
    public.redact_audit_payload(v_entity_type, v_after)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 9 audited tables: AFTER INSERT/UPDATE/DELETE trigger 個別作成 (冪等)
DROP TRIGGER IF EXISTS trg_audit_users ON public.users;
DROP TRIGGER IF EXISTS trg_audit_customers ON public.customers;
DROP TRIGGER IF EXISTS trg_audit_vehicles ON public.vehicles;
DROP TRIGGER IF EXISTS trg_audit_vendors ON public.vendors;
DROP TRIGGER IF EXISTS trg_audit_vendor_users ON public.vendor_users;
DROP TRIGGER IF EXISTS trg_audit_service_tickets ON public.service_tickets;
DROP TRIGGER IF EXISTS trg_audit_reservations ON public.reservations;
DROP TRIGGER IF EXISTS trg_audit_transport_orders ON public.transport_orders;
DROP TRIGGER IF EXISTS trg_audit_transport_order_invitations ON public.transport_order_invitations;

CREATE TRIGGER trg_audit_users AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_customers AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_vehicles AFTER INSERT OR UPDATE OR DELETE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_vendor_users AFTER INSERT OR UPDATE OR DELETE ON public.vendor_users
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_service_tickets AFTER INSERT OR UPDATE OR DELETE ON public.service_tickets
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_reservations AFTER INSERT OR UPDATE OR DELETE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_transport_orders AFTER INSERT OR UPDATE OR DELETE ON public.transport_orders
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
CREATE TRIGGER trg_audit_transport_order_invitations AFTER INSERT OR UPDATE OR DELETE ON public.transport_order_invitations
  FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();

REVOKE EXECUTE ON FUNCTION public.record_audit_log() FROM PUBLIC, anon, authenticated;
