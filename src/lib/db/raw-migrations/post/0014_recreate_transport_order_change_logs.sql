-- Phase 53: transport_order_change_logs を spec §7.8 完全準拠の新 schema に DROP + recreate。
-- 旧 schema (payload jsonb + updated_at) は service 未利用で data 蓄積なし前提、CASCADE で
-- 旧 RLS policy + updated_at trigger + dependent objects を全て drop してから新 schema を CREATE。
-- RLS は既存 tenant_isolation pattern (19_rls_policies.sql) と同じく recreate。

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.transport_order_change_logs;
DROP TABLE IF EXISTS public.transport_order_change_logs CASCADE;

CREATE TABLE public.transport_order_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES public.transport_orders(id) ON DELETE CASCADE,
  change_type text NOT NULL CHECK (change_type IN ('vendor_changed', 'datetime_changed', 'cancelled', 'recreated', 'rejected_reassigned')),
  before_json jsonb,
  after_json jsonb,
  changed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requires_notification boolean NOT NULL DEFAULT true,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transport_order_change_logs_transport_order_created_at
  ON public.transport_order_change_logs (transport_order_id, created_at);

ALTER TABLE public.transport_order_change_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.transport_order_change_logs;
CREATE POLICY tenant_isolation ON public.transport_order_change_logs
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
