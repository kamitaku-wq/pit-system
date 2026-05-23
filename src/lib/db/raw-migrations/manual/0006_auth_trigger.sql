-- ⚠️ 適用方法: Supabase Dashboard > SQL Editor (superuser) で手動実行 ⚠️
--
-- このファイルは pnpm db:apply-raw:post では失敗する。理由:
-- Supabase の auth.users テーブルは supabase_auth_admin 所有で、
-- DATABASE_URL / DIRECT_URL の postgres ロールでは CREATE TRIGGER 不可。
--
-- _raw_migrations tracking テーブルへの記録も手動で:
--   INSERT INTO _raw_migrations (filename) VALUES ('0006_auth_trigger.sql');
--
-- 目的: auth.users 削除時に public.users / public.vendor_users の対応行を soft delete
-- spec/data-model.md §3.2.1 を vendor_users にも拡張 (両者 auth.users.id と 1:1 のため対称)

CREATE OR REPLACE FUNCTION public.sync_user_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.users
    SET deleted_at = now(), is_active = false
    WHERE id = OLD.id AND deleted_at IS NULL;
  UPDATE public.vendor_users
    SET deleted_at = now(), is_active = false
    WHERE id = OLD.id AND deleted_at IS NULL;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_delete();
