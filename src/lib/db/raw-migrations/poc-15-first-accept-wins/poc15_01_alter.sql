-- PoC #15 先着受注: transport_order_invitations に response/is_winning_bid/responded_at を追加
-- spec/data-model.md §7.10 確定列のうち PoC スコープ最小サブセット
-- α-1 で残り列 (invitation_token_hash, invitee_email, expires_at, bound_vendor_*) を追加

ALTER TABLE pit_v24_poc.transport_order_invitations
  ADD COLUMN IF NOT EXISTS response text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS is_winning_bid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

ALTER TABLE pit_v24_poc.transport_order_invitations
  DROP CONSTRAINT IF EXISTS transport_order_invitations_response_check;

ALTER TABLE pit_v24_poc.transport_order_invitations
  ADD CONSTRAINT transport_order_invitations_response_check
  CHECK (response IN ('pending', 'accepted', 'rejected', 'revoked', 'expired'));
