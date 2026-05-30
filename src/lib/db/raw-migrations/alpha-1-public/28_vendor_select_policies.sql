-- Phase 27-A: vendor portal で statuses / companies が join 経由で消える問題の修正。
-- 既存 19_rls_policies.sql は admin 用 tenant_isolation (FOR ALL, current_user_company_id())
-- のみで、vendor user (public.users 不在) からは見えなかった。
-- 既存 transport_orders.vendor_portal_select と同じく
-- vendor_accessible_company_ids(current_vendor_id()) を helper として再利用する。

DROP POLICY IF EXISTS vendor_select ON public.statuses;
CREATE POLICY vendor_select ON public.statuses
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.vendor_accessible_company_ids(public.current_vendor_id()))
  );

DROP POLICY IF EXISTS vendor_select ON public.companies;
CREATE POLICY vendor_select ON public.companies
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT public.vendor_accessible_company_ids(public.current_vendor_id()))
  );
