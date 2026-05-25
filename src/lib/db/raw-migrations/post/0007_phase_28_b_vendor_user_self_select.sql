-- Phase 28-B: vendor user が自分の vendor_users 行を SELECT 可能にする。
-- Root cause: 19_rls_policies.sql の vendor_users に貼られた唯一の policy は
-- tenant_isolation (company_id = current_user_company_id()) で、社内 users 用。
-- vendor user として login した場合 current_user_company_id() = NULL となり
-- vendor_users 全行が authenticated role から hidden。
--
-- 結果として、transport_order_invitations.vendor_select policy (post/0006) の
-- USING 内 EXISTS subquery (SELECT 1 FROM vendor_users vu WHERE vu.id =
-- current_vendor_user_id() ...) が authenticated role で評価され、vendor_users RLS で
-- 0 件 → EXISTS FALSE → Spot invitation が `/vendor/requests` で不可視となっていた。
-- Loop invitation は第 1 branch (vendor_id = current_vendor_id()) で pass するため
-- 顕在化していなかった (Phase 16/24 で 26_spot_helper_rls 導入時から潜伏)。
--
-- 修正: vendor user が自分の vendor_users 行を SELECT 可能な self_select policy を追加。
-- これにより policy USING 内の EXISTS が機能する。

DROP POLICY IF EXISTS vendor_self_select ON public.vendor_users;
CREATE POLICY vendor_self_select ON public.vendor_users
  FOR SELECT TO authenticated
  USING (id = public.current_vendor_user_id());
