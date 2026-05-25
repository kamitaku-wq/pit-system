-- Phase 31-B: admin_vendor_invitations
-- Admin が vendor を招待するための招待状管理テーブル。
-- 案 B 設計 (phase-23-sprint-beta-recon-admin-invite.md §4-5):
--   admin が createAdminVendorInvitation を呼ぶ → supabase auth invite メール送信
--   招待された vendor user がリンクをクリック → accept callback で status='accepted' に更新
-- 関連 service: src/lib/services/admin-vendor-invitations.ts
-- 関連 callback: src/app/(vendor-portal)/vendor/admin-invite-callback/route.ts
--
-- tenant_isolation: 社内 admin のみアクセス可。vendor portal は current_user_company_id() = NULL のため
-- 自動的に 0 行となり、設計通り vendor 側からは不可視。accept callback は service_role バイパス。

DROP TABLE IF EXISTS public.admin_vendor_invitations CASCADE;

CREATE TABLE public.admin_vendor_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  invited_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  vendor_user_id uuid REFERENCES public.vendor_users(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text,
  role text NOT NULL DEFAULT 'vendor_admin'
    CHECK (role IN ('vendor_admin', 'vendor_member')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'accepted', 'expired', 'revoked')),
  token_hash text UNIQUE,
  expires_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE partial index: 同一 vendor 内で pending な email を 1 件に制限 (重複招待防止)
CREATE UNIQUE INDEX admin_vendor_invitations_pending_unique
  ON public.admin_vendor_invitations (vendor_id, email)
  WHERE status = 'pending';

-- vendor_user_id 経由の lookup (accept callback で使用)
CREATE INDEX admin_vendor_invitations_vendor_user_id_idx
  ON public.admin_vendor_invitations (vendor_user_id)
  WHERE vendor_user_id IS NOT NULL;

-- updated_at auto-update trigger
DROP TRIGGER IF EXISTS admin_vendor_invitations_set_updated_at ON public.admin_vendor_invitations;
CREATE TRIGGER admin_vendor_invitations_set_updated_at
  BEFORE UPDATE ON public.admin_vendor_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.admin_vendor_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.admin_vendor_invitations;
CREATE POLICY tenant_isolation ON public.admin_vendor_invitations
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
