CREATE MATERIALIZED VIEW lane_utilization_daily AS
SELECT
  reservations.company_id,
  reservations.store_id,
  reservations.lane_id,
  date_trunc('day', reservations.start_at)::date AS service_date,
  count(*)::integer AS reservation_count,
  sum(extract(epoch FROM (reservations.end_at - reservations.start_at)) / 60)::integer AS reserved_minutes
FROM reservations
WHERE reservations.deleted_at IS NULL
GROUP BY
  reservations.company_id,
  reservations.store_id,
  reservations.lane_id,
  date_trunc('day', reservations.start_at)::date
WITH NO DATA;

CREATE MATERIALIZED VIEW vendor_response_kpi_daily AS
SELECT
  transport_order_invitations.company_id,
  transport_order_invitations.vendor_id,
  date_trunc('day', transport_order_invitations.created_at)::date AS invited_date,
  count(*)::integer AS invitation_count,
  count(*) FILTER (WHERE transport_order_invitations.response = 'accepted')::integer AS accepted_count,
  count(*) FILTER (WHERE transport_order_invitations.response = 'rejected')::integer AS rejected_count
FROM transport_order_invitations
GROUP BY
  transport_order_invitations.company_id,
  transport_order_invitations.vendor_id,
  date_trunc('day', transport_order_invitations.created_at)::date
WITH NO DATA;

CREATE MATERIALIZED VIEW notification_delivery_kpi_daily AS
SELECT
  notification_deliveries.company_id,
  notification_deliveries.channel,
  date_trunc('day', notification_deliveries.created_at)::date AS delivery_date,
  count(*)::integer AS delivery_count,
  count(*) FILTER (WHERE notification_deliveries.status = 'sent')::integer AS sent_count,
  count(*) FILTER (WHERE notification_deliveries.status = 'failed')::integer AS failed_count
FROM notification_deliveries
GROUP BY
  notification_deliveries.company_id,
  notification_deliveries.channel,
  date_trunc('day', notification_deliveries.created_at)::date
WITH NO DATA;

CREATE UNIQUE INDEX ix_lane_utilization_daily_unique
  ON lane_utilization_daily(company_id, store_id, lane_id, service_date);

CREATE UNIQUE INDEX ix_vendor_response_kpi_daily_unique
  ON vendor_response_kpi_daily(company_id, vendor_id, invited_date);

CREATE UNIQUE INDEX ix_notification_delivery_kpi_daily_unique
  ON notification_delivery_kpi_daily(company_id, channel, delivery_date);
