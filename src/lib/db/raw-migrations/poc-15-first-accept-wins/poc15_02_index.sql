-- PoC #15 先着受注: partial UNIQUE index で「1 transport_order あたり is_winning_bid=true は 1 件のみ」を DB 強制
-- spec/data-model.md §7.10.2 line 873-876

CREATE UNIQUE INDEX IF NOT EXISTS transport_order_invitations_winning_unique
  ON pit_v24_poc.transport_order_invitations (transport_order_id)
  WHERE is_winning_bid = true;
