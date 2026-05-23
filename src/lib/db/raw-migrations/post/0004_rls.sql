-- RLS 有効化
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_users ENABLE ROW LEVEL SECURITY;

-- companies: 社内ユーザーから自社を SELECT
CREATE POLICY companies_select_for_user
  ON public.companies FOR SELECT
  USING (id = public.current_user_company_id());

-- companies: vendor_user から自社 (vendor が属する company) を SELECT
CREATE POLICY companies_select_for_vendor
  ON public.companies FOR SELECT
  USING (id = public.current_vendor_user_company_id());

-- users: 同じ company の社内ユーザーから SELECT
CREATE POLICY users_select_same_company
  ON public.users FOR SELECT
  USING (company_id = public.current_user_company_id());

-- users: 自分自身の行のみ UPDATE 可、かつ company_id 不変 (テナント脱出防止)
CREATE POLICY users_update_self
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND company_id = public.current_user_company_id());

-- vendor_users: 同 company の社内ユーザーから SELECT (業者管理画面用)
CREATE POLICY vendor_users_select_by_user
  ON public.vendor_users FOR SELECT
  USING (company_id = public.current_user_company_id());

-- vendor_users: 自分自身を SELECT (vendor portal ログイン直後など)
CREATE POLICY vendor_users_select_self
  ON public.vendor_users FOR SELECT
  USING (id = auth.uid());

-- vendor_users: 自分自身を UPDATE、company_id / vendor_id は不変 (テナント脱出防止)
CREATE POLICY vendor_users_update_self
  ON public.vendor_users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND company_id = public.current_vendor_user_company_id()
    AND vendor_id IS NOT DISTINCT FROM public.current_vendor_id()
  );
