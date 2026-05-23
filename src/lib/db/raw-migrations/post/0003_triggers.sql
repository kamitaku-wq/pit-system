-- 3 テーブルに updated_at 自動更新 trigger を適用
CREATE TRIGGER trg_companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_vendor_users_set_updated_at
  BEFORE UPDATE ON public.vendor_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 注: auth.users 削除 trigger は権限制約で別ファイル 0006_auth_trigger.sql に分離。
-- Supabase では auth.users が supabase_auth_admin 所有のため、
-- 通常の postgres ロール (DATABASE_URL / DIRECT_URL) では CREATE TRIGGER できない。
-- Supabase Dashboard の SQL Editor (superuser) で 0006_auth_trigger.sql を実行する。
