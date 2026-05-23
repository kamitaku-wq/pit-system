CREATE TABLE pit_v24_poc.transport_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  service_ticket_id uuid REFERENCES pit_v24_poc.service_tickets(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES pit_v24_poc.reservations(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  tow_required boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT transport_orders_movement_type_check CHECK (movement_type IN ('self_drive', 'tow', 'carrier')),
  CONSTRAINT transport_orders_tow_check CHECK (movement_type <> 'tow' OR tow_required = true)
);

CREATE TABLE pit_v24_poc.transport_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES pit_v24_poc.transport_orders(id) ON DELETE CASCADE,
  status_id uuid REFERENCES pit_v24_poc.statuses(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES pit_v24_poc.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.transport_order_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES pit_v24_poc.transport_orders(id) ON DELETE CASCADE,
  changed_by_user_id uuid REFERENCES pit_v24_poc.users(id) ON DELETE SET NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.transport_order_vendor_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES pit_v24_poc.transport_orders(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES pit_v24_poc.vendors(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.transport_order_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES pit_v24_poc.transport_orders(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES pit_v24_poc.vendors(id) ON DELETE SET NULL,
  invited_by_user_id uuid REFERENCES pit_v24_poc.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE pit_v24_poc.vendor_selection_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES pit_v24_poc.transport_orders(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES pit_v24_poc.transport_order_invitations(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES pit_v24_poc.vendors(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- alpha-1: add pickup_store_id delivery_store_id vehicle_id status_id assigned vendor response metadata.
