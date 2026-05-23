CREATE TABLE pit_v24_poc.notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid,
  event_key text NOT NULL,
  channel text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  transport_order_id uuid REFERENCES pit_v24_poc.transport_orders(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES pit_v24_poc.reservations(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES pit_v24_poc.transport_order_invitations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  notification_outbox_id uuid NOT NULL REFERENCES pit_v24_poc.notification_outbox(id) ON DELETE CASCADE,
  channel text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.vendor_portal_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  vendor_id uuid REFERENCES pit_v24_poc.vendors(id) ON DELETE CASCADE,
  vendor_user_id uuid REFERENCES pit_v24_poc.vendor_users(id) ON DELETE SET NULL,
  notification_outbox_id uuid REFERENCES pit_v24_poc.notification_outbox(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- alpha-1: add payload, delivery status, provider ids, retry counters, inbox read state.
