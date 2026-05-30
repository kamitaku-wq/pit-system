-- Phase 64-C follow-up #2 (security hardening / RPC 認可 bypass fix):
--   accept_invitation_and_revoke_others の認可ガードを復元し、cross-tenant invitation accept
--   バイパスを封鎖する。
--
-- 背景 (regression の経緯):
--   原版 (alpha-1-public/18_helper_functions.sql) は accept 前に
--     ① spot invitation (vendor_id IS NULL) を弾く
--     ② caller が active な vendor user で、招待の vendor (vendor_id) に属することを検証
--   していた。post/0006 (Phase 27-A) が「ambiguous column reference 修正」として
--   CREATE OR REPLACE した際、列 qualify (toi/tro alias 化) と引き換えに ①② の認可ガードを
--   巻き添え削除した (post/0006 のコメントは column 修正のみ言及 = 事故)。
--
--   結果: respond_to_transport_order (24_vendor_rpcs.sql) の accept 経路は helper 呼出前に
--   vendor 認可せず helper に委譲するため、GRANT EXECUTE が authenticated の
--   respond_to_transport_order を介して、任意の authenticated user が他 vendor の pending
--   invitation を accept でき (競合 invitation revoke + transport_orders.vendor_id 奪取)、
--   cross-tenant auth bypass となっていた (Codex adversarial が surface)。
--   重大度は UUID-gated (transport_order_invitations の vendor_select RLS が他 vendor の
--   invitation 列挙を防ぐ) だが、boundary は status_id column bypass (RLS で自社案件限定) より広い。
--
-- なぜ guard 復元が正規フローを壊さないか (caller trace 確認済):
--   - helper の prod caller は respond_to_transport_order のみ (登録 vendor accept)。
--     vendor portal action (withAuthenticatedDb = vendor session) → respondToInvitation →
--     respond_to_transport_order と辿り、current_vendor_user_id() は招待 vendor の user に解決する。
--     respond は SECURITY DEFINER だが request.jwt.claims (session GUC) は definer 跨ぎで保持される。
--   - spot accept は別 RPC respond_to_spot_invitation (27_spot_rpc.sql) が独自の email-match 認可で
--     処理し、helper を経由しない (27_spot_rpc が「helper を変更するな」と明記)。spot-rejection
--     guard (①) 復元も spot flow に無影響。
--   - admin / 代理 accept は存在しない。
--   - 24_vendor_rpcs.sql は touch 不可 invariant のため、respond の accept 経路を塞ぐ修正は
--     respond が呼ぶ helper 側に集約する (本 migration)。
--
-- 修正:
--   ① 認可ガード (spot 弾き + vendor user membership 一致) を復元。post/0006 の列 qualify は維持。
--      bound_vendor_user_id も原版同様セットする。
--   ② REVOKE EXECUTE FROM PUBLIC, anon, authenticated (defense-in-depth)。respond_to_transport_order
--      は SECURITY DEFINER = owner 実行ゆえ helper を呼べる。vendor が helper を直接呼ぶ正規用途は無い。
--
-- 冪等性: CREATE OR REPLACE + REVOKE は再適用安全。db:setup 適用順 (alpha-1-public/18,24 →
--   post/0006 → post/0032) により本 migration が最終定義となる。

CREATE OR REPLACE FUNCTION public.accept_invitation_and_revoke_others(p_invitation_id uuid)
RETURNS TABLE(transport_order_id uuid, version int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transport_order_id uuid;
  v_vendor_id uuid;
  v_vendor_user_id uuid;
  v_new_version int;
BEGIN
  SELECT toi.transport_order_id, toi.vendor_id
    INTO v_transport_order_id, v_vendor_id
  FROM public.transport_order_invitations toi
  WHERE toi.id = p_invitation_id
    AND toi.response = 'pending';

  IF v_transport_order_id IS NULL THEN
    RAISE EXCEPTION 'invitation not pending or not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- ① スポット招待 (vendor 未確定) は本関数スコープ外 (respond_to_spot_invitation が処理)。
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'invitation has no bound vendor (spot invitation flow)'
      USING ERRCODE = 'P0002';
  END IF;

  -- ② 認可ガード (post/0032 で復元): caller が active vendor user で、招待の vendor に属すること。
  --   respond_to_transport_order (SECURITY DEFINER) 経由でも request.jwt.claims は保持されるため
  --   current_vendor_user_id() は実呼び出し元 vendor user に解決する。これにより任意の authenticated
  --   user が他 vendor の invitation を accept する cross-tenant bypass を封鎖する。
  v_vendor_user_id := public.current_vendor_user_id();
  IF v_vendor_user_id IS NULL THEN
    RAISE EXCEPTION 'caller is not an authenticated vendor user'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_users vu
    WHERE vu.id = v_vendor_user_id
      AND vu.vendor_id = v_vendor_id
      AND vu.is_active = true
      AND vu.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'caller vendor_user does not belong to invitation vendor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext(v_transport_order_id::text)) THEN
    RAISE EXCEPTION 'transport_order % is being processed concurrently', v_transport_order_id
      USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transport_order_invitations toi2
    WHERE toi2.transport_order_id = v_transport_order_id
      AND toi2.is_winning_bid = true
  ) THEN
    RAISE EXCEPTION 'transport_order % already has winning bid', v_transport_order_id
      USING ERRCODE = '55P03';
  END IF;

  UPDATE public.transport_order_invitations toi
  SET response = 'accepted',
      is_winning_bid = true,
      responded_at = now(),
      bound_vendor_id = v_vendor_id,
      bound_vendor_user_id = v_vendor_user_id
  WHERE toi.id = p_invitation_id;

  UPDATE public.transport_order_invitations toi
  SET response = 'revoked',
      responded_at = now()
  WHERE toi.transport_order_id = v_transport_order_id
    AND toi.id <> p_invitation_id
    AND toi.response = 'pending';

  UPDATE public.transport_orders tro
  SET vendor_id = v_vendor_id,
      version = tro.version + 1,
      updated_at = now()
  WHERE tro.id = v_transport_order_id
  RETURNING tro.version INTO v_new_version;

  RETURN QUERY SELECT v_transport_order_id, v_new_version;
END;
$$;

-- defense in depth: vendor は respond_to_transport_order (SECURITY DEFINER = owner 実行) 経由でのみ
-- 本 helper を呼ぶ。authenticated への直接 EXECUTE を剥奪する (BLOCK 2)。owner は所有者ゆえ EXECUTE 保持。
REVOKE EXECUTE ON FUNCTION public.accept_invitation_and_revoke_others(uuid) FROM PUBLIC, anon, authenticated;
