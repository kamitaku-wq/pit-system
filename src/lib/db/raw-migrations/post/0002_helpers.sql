-- 共通 updated_at 自動更新 trigger 関数
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- RLS helper: 社内ユーザー auth.uid() → users.company_id
-- SECURITY DEFINER で RLS をバイパスして company_id を取得 (循環依存回避)
CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;

-- RLS helper: vendor_user auth.uid() → vendor_users.company_id
-- spec/data-model.md §14 の意図: 社内ユーザーと vendor_user で helper を分離
-- (両者は別テーブル、auth.uid() が指す先が異なる)
CREATE OR REPLACE FUNCTION public.current_vendor_user_company_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT company_id FROM public.vendor_users WHERE id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;

-- RLS helper: vendor_user auth.uid() → vendor_users.vendor_id
CREATE OR REPLACE FUNCTION public.current_vendor_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT vendor_id FROM public.vendor_users WHERE id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;
