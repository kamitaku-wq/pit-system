-- PoC #15 先着受注: accept_invitation_and_revoke_others 関数本体
-- spec/data-model.md §7.10.2 line 881-933 から PoC スコープ最小版へ移植
-- 差分:
--   - transport_orders.vendor_id / version バインドは α-1 (PoC 対象外)
--   - bound_vendor_user_id は p_acting_vendor_user_id をそのまま記録 (vendor_users JOIN 省略)
--   - RETURNS uuid (winning invitation_id) に簡略化
--
-- 並列制御:
--   1. SELECT FOR UPDATE で対象 invitation を row lock (50 並列で各 row 排他)
--   2. UPDATE で is_winning_bid=true SET → partial unique index で「1 transport_order あたり 1 件」強制
--      49 件は SQLSTATE 23505 (unique_violation) で失敗
--   3. winning が確定したら他 pending を revoke

CREATE OR REPLACE FUNCTION pit_v24_poc.accept_invitation_and_revoke_others(
  p_invitation_id uuid,
  p_acting_vendor_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pit_v24_poc
AS $$
DECLARE
  v_transport_order_id uuid;
BEGIN
  -- 1. 招待を row lock 取得 (response='pending' のみ対象)
  SELECT transport_order_id
    INTO v_transport_order_id
    FROM pit_v24_poc.transport_order_invitations
    WHERE id = p_invitation_id
      AND response = 'pending'
      AND deleted_at IS NULL
    FOR UPDATE;

  IF v_transport_order_id IS NULL THEN
    RAISE EXCEPTION 'Invitation % not pending or not found', p_invitation_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 2. winning bid にセット (49 件はここで partial unique violation 23505)
  UPDATE pit_v24_poc.transport_order_invitations
    SET response = 'accepted',
        responded_at = now(),
        is_winning_bid = true,
        updated_at = now()
    WHERE id = p_invitation_id;

  -- 3. 同 transport_order の他 pending を revoke
  UPDATE pit_v24_poc.transport_order_invitations
    SET response = 'revoked',
        responded_at = now(),
        updated_at = now()
    WHERE transport_order_id = v_transport_order_id
      AND id <> p_invitation_id
      AND response = 'pending';

  RETURN p_invitation_id;
END;
$$;
