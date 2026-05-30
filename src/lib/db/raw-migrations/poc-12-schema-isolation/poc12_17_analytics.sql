CREATE MATERIALIZED VIEW pit_v24_poc.lane_utilization_daily AS
SELECT
  pit_v24_poc.reservations.company_id,
  pit_v24_poc.reservations.store_id,
  pit_v24_poc.reservations.lane_id,
  date_trunc('day', pit_v24_poc.reservations.start_at)::date AS service_date,
  count(*)::integer AS reservation_count
FROM pit_v24_poc.reservations
GROUP BY
  pit_v24_poc.reservations.company_id,
  pit_v24_poc.reservations.store_id,
  pit_v24_poc.reservations.lane_id,
  date_trunc('day', pit_v24_poc.reservations.start_at)::date
WITH NO DATA;

CREATE MATERIALIZED VIEW pit_v24_poc.vendor_response_kpi_daily AS
SELECT
  pit_v24_poc.transport_order_invitations.company_id,
  pit_v24_poc.transport_order_invitations.vendor_id,
  date_trunc('day', pit_v24_poc.transport_order_invitations.created_at)::date AS invited_date,
  count(*)::integer AS invitation_count
FROM pit_v24_poc.transport_order_invitations
GROUP BY
  pit_v24_poc.transport_order_invitations.company_id,
  pit_v24_poc.transport_order_invitations.vendor_id,
  date_trunc('day', pit_v24_poc.transport_order_invitations.created_at)::date
WITH NO DATA;
