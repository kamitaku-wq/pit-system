CREATE TABLE transport_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  service_ticket_id uuid REFERENCES service_tickets(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  pickup_store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  delivery_store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  tow_required boolean NOT NULL DEFAULT false,
  pickup_address text,
  delivery_address text,
  requested_pickup_at timestamptz,
  requested_delivery_at timestamptz,
  assigned_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  price_minor integer NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  notes text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_orders_movement_type_check CHECK (movement_type IN ('self_drive', 'tow', 'carrier')),
  CONSTRAINT transport_orders_tow_check CHECK (movement_type <> 'tow' OR tow_required = true)
);

CREATE TABLE transport_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  from_status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transport_order_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transport_order_vendor_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transport_order_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  invitation_token_hash text,
  invitee_email text,
  expires_at timestamptz,
  response text NOT NULL DEFAULT 'pending',
  is_winning_bid boolean NOT NULL DEFAULT false,
  responded_at timestamptz,
  bound_vendor_user_id uuid REFERENCES vendor_users(id) ON DELETE SET NULL,
  bound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT transport_order_invitations_response_check CHECK (response IN ('pending', 'accepted', 'rejected', 'revoked', 'expired'))
);

CREATE TABLE vendor_selection_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES transport_order_invitations(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  selected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  selection_reason text,
  score jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX transport_order_invitations_winning_unique
  ON transport_order_invitations(transport_order_id)
  WHERE is_winning_bid = true;

CREATE INDEX ix_transport_orders_vendor_status ON transport_orders(vendor_id, status_id);
CREATE INDEX ix_transport_order_invitations_vendor ON transport_order_invitations(vendor_id, response) WHERE deleted_at IS NULL;
