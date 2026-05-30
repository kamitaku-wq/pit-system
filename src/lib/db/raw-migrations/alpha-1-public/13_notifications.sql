DROP TABLE IF EXISTS notification_rules CASCADE;

CREATE TABLE notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('vendor','customer','store_user')),
  channel text NOT NULL CHECK (channel IN ('email','portal','line','sms','both')),
  is_enabled bool NOT NULL DEFAULT true,
  timing_minutes_offset int,
  retry_after_minutes int,
  max_reminders int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, event_type, target_type, channel)
);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid REFERENCES transport_orders(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  transport_order_invitation_id uuid REFERENCES transport_order_invitations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  event_type text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('vendor', 'customer', 'store_user')),
  target_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  scheduled_at timestamptz,
  processing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

DROP TABLE IF EXISTS notification_deliveries CASCADE;

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','portal','line','sms')),
  attempt_seq integer NOT NULL,
  provider text,
  provider_message_id text,
  result text NOT NULL CHECK (result IN ('sent','failed','bounced','opened','clicked','delivered')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendor_portal_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  recipient_vendor_user_id uuid REFERENCES vendor_users(id) ON DELETE SET NULL,
  outbox_id uuid REFERENCES notification_outbox(id) ON DELETE CASCADE,
  transport_order_id uuid REFERENCES transport_orders(id) ON DELETE CASCADE,
  transport_order_invitation_id uuid REFERENCES transport_order_invitations(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'action_required', 'urgent')),
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_notification_outbox_pending
  ON notification_outbox(status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX ix_notification_outbox_scheduled
  ON notification_outbox(scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE INDEX ix_notification_deliveries_outbox_attempt_seq
  ON notification_deliveries(outbox_id, attempt_seq);

CREATE INDEX ix_vendor_portal_inbox_unread
  ON vendor_portal_inbox(vendor_id, read_at)
  WHERE archived_at IS NULL;
