-- Phase 64-C.3 (L2-12): 業者完了報告 RPC。
--   業者 (vendor user) が accept 済みの陸送依頼を「完了」報告する。status を accepted→completed に
--   遷移させ、引取/搬入/返却の実績時刻 (picked_up_at/delivered_at/returned_at) を任意セットし、
--   transport_order_status_history に append する。
--
-- なぜ SECURITY DEFINER RPC か (advisor C.3 確定):
--   - vendor portal は withAuthenticatedDb (vendor session) で動く。vendor session は
--     transport_order_status_history を **INSERT 不可** (RLS: WITH CHECK company_id=current_user_company_id()
--     が vendor で NULL になる, 19_rls_policies.sql:271-274)。完了は status_history を残すため
--     (accept/cancel と整合)、definer 経路が必須。respond_to_transport_order と同型。
--   - status_id / picked_up_at 等は vendor の column GRANT 内だが、history を伴うため RPC に集約する。
--
-- 認可: 呼び出しは active な vendor user (current_vendor_user_id) かつ、対象 order の vendor_id が
--   呼び出し vendor (current_vendor_id) と一致する winning vendor であること。invitation 経由で order を解決。
--
-- 遷移: accepted→completed は C.0 (post/0028) で per-company seed 済。enforce_status_transition trigger
--   (20_triggers.sql, transport_orders BEFORE UPDATE OF status_id) が最終検証。本 RPC は from=accepted を
--   明示チェックし、UPDATE WHERE status_id=<accepted> で並行二重完了を防ぐ (0 行→concurrent エラー)。
--   C.1 auto-confirm trigger は status='accepted' のみ反応するため completed 遷移では no-op。
--
-- 通知: 店舗向け完了通知 (outbox) は本 RPC では enqueue しない (C.3 では defer)。
--   理由: outbox dispatcher は payload.to/subject/html を直接送信する契約だが transport 系通知
--   (cancel/confirm) は構造化 payload で email 未レンダリング = 実送信されない既存ギャップ。
--   かつ store_user 通知の target_id 解決パターンが未確立。店舗は admin UI で status=completed +
--   実績時刻を確認できる。完了 email 通知 + dispatcher payload 契約は cancel/confirm と共通の
--   cross-cutting follow-up (idempotency_key to:{id}:completed:v{ver} は §15.6 に予約済)。
--
-- 実行 role: authenticated (vendor user)。SECURITY DEFINER + search_path 固定。

CREATE OR REPLACE FUNCTION public.complete_transport_order(
  p_invitation_id uuid,
  p_picked_up_at timestamptz DEFAULT NULL,
  p_delivered_at timestamptz DEFAULT NULL,
  p_returned_at timestamptz DEFAULT NULL
)
RETURNS TABLE(
  transport_order_id uuid,
  version int,
  new_status_id uuid,
  history_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_user_id uuid;
  v_caller_vendor_id uuid;
  v_transport_order_id uuid;
  v_invitation_vendor_id uuid;
  v_company_id uuid;
  v_order_vendor_id uuid;
  v_from_status_id uuid;
  v_from_key text;
  v_completed_status_id uuid;
  v_version int;
  v_history_id uuid;
BEGIN
  -- 認可: active な vendor user か
  v_vendor_user_id := public.current_vendor_user_id();
  IF v_vendor_user_id IS NULL THEN
    RAISE EXCEPTION 'caller is not vendor user' USING ERRCODE = '42501';
  END IF;
  v_caller_vendor_id := public.current_vendor_id();

  -- invitation から order を解決 (accepted 済の winning invitation)
  SELECT toi.transport_order_id, toi.vendor_id
    INTO v_transport_order_id, v_invitation_vendor_id
  FROM public.transport_order_invitations toi
  WHERE toi.id = p_invitation_id
    AND toi.response = 'accepted';

  IF v_transport_order_id IS NULL THEN
    RAISE EXCEPTION 'invitation not found or not accepted' USING ERRCODE = 'P0002';
  END IF;

  -- order 取得
  SELECT t.company_id, t.vendor_id, t.status_id
    INTO v_company_id, v_order_vendor_id, v_from_status_id
  FROM public.transport_orders t
  WHERE t.id = v_transport_order_id
    AND t.deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'transport order not found' USING ERRCODE = 'P0002';
  END IF;

  -- 認可: 呼び出し vendor が当該 order の winning vendor であること
  IF v_caller_vendor_id IS NULL
     OR v_order_vendor_id IS DISTINCT FROM v_caller_vendor_id
     OR v_invitation_vendor_id IS DISTINCT FROM v_caller_vendor_id THEN
    RAISE EXCEPTION 'caller is not the assigned vendor for this order' USING ERRCODE = '42501';
  END IF;

  -- from が accepted であること (completed は accepted からのみ)
  SELECT s.key INTO v_from_key
  FROM public.statuses s
  WHERE s.id = v_from_status_id;

  IF v_from_key IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'transport order is not in accepted status (current: %)', v_from_key
      USING ERRCODE = 'P0002';
  END IF;

  -- completed status id
  SELECT s.id INTO v_completed_status_id
  FROM public.statuses s
  WHERE s.company_id = v_company_id
    AND s.status_type = 'transport'
    AND s.key = 'completed'
    AND s.is_active = true
  LIMIT 1;

  IF v_completed_status_id IS NULL THEN
    RAISE EXCEPTION 'completed status not seeded for company' USING ERRCODE = 'P0002';
  END IF;

  -- accepted のときだけ completed へ遷移 (並行二重完了は status_id ガードで 0 行 → concurrent エラー)。
  -- COALESCE: p_* が NULL の timestamp 列は既存値を維持する (本 RPC で NULL クリアは不可。
  -- 完了は set-once の terminal 遷移ゆえクリア不要)。
  UPDATE public.transport_orders
  SET status_id = v_completed_status_id,
      picked_up_at = COALESCE(p_picked_up_at, picked_up_at),
      delivered_at = COALESCE(p_delivered_at, delivered_at),
      returned_at = COALESCE(p_returned_at, returned_at),
      version = version + 1,
      updated_at = now()
  WHERE id = v_transport_order_id
    AND status_id = v_from_status_id
  RETURNING version INTO v_version;

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'transport order was concurrently modified' USING ERRCODE = '55P03';
  END IF;

  INSERT INTO public.transport_order_status_history (
    company_id,
    transport_order_id,
    from_status_id,
    to_status_id,
    changed_by_user_id,
    reason
  )
  VALUES (
    v_company_id,
    v_transport_order_id,
    v_from_status_id,
    v_completed_status_id,
    NULL, -- vendor user は users テーブル外。accept (respond RPC) と同じく NULL。
    'vendor_complete'
  )
  RETURNING id INTO v_history_id;

  RETURN QUERY
    SELECT v_transport_order_id, v_version, v_completed_status_id, v_history_id;
END;
$$;

-- defense in depth: PUBLIC/anon の暗黙 EXECUTE を剥奪し authenticated (vendor user) のみに限定
-- (0028 と同方針。anon は current_vendor_user_id() NULL で 42501 になるが least-privilege を明示)。
REVOKE EXECUTE ON FUNCTION public.complete_transport_order(uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_transport_order(uuid, timestamptz, timestamptz, timestamptz) TO authenticated;
