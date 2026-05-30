DROP TABLE IF EXISTS vendor_selection_logs CASCADE;
DROP TABLE IF EXISTS transport_order_invitations CASCADE;
DROP TABLE IF EXISTS transport_order_vendor_attempts CASCADE;
DROP TABLE IF EXISTS transport_orders CASCADE;

CREATE TABLE transport_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  order_number text NOT NULL,
  service_ticket_id uuid NOT NULL REFERENCES service_tickets(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  pickup_store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  delivery_store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  return_store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  can_drive boolean NOT NULL DEFAULT true,
  tow_required boolean NOT NULL DEFAULT false,
  requested_pickup_at timestamptz,
  requested_delivery_at timestamptz,
  requested_return_at timestamptz,
  scheduled_pickup_at timestamptz,
  scheduled_delivery_at timestamptz,
  scheduled_return_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  returned_at timestamptz,
  vendor_response text NOT NULL DEFAULT 'pending',
  vendor_response_at timestamptz,
  vendor_rejection_reason text,
  confirmation_mode text NOT NULL DEFAULT 'auto',
  store_confirmed_at timestamptz,
  store_confirmed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status_id uuid NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT,
  notification_sent_at timestamptz,
  notes text,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DROP TABLE IF EXISTS transport_order_status_history CASCADE;

CREATE TABLE transport_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  from_status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  to_status_id uuid NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transport_order_status_history_transport_order_changed_at
  ON transport_order_status_history (transport_order_id, changed_at);

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
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  attempt_seq integer NOT NULL,
  requested_at timestamptz NOT NULL,
  response text,
  responded_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transport_order_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  invitee_email text,
  invitee_name text,
  invitee_phone text,
  invited_at timestamptz NOT NULL DEFAULT now(),
  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  invitation_token_hash text,
  expires_at timestamptz,
  response text NOT NULL DEFAULT 'pending',
  responded_at timestamptz,
  is_winning_bid boolean NOT NULL DEFAULT false,
  bound_vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  bound_vendor_user_id uuid REFERENCES vendor_users(id) ON DELETE SET NULL
);

CREATE TABLE vendor_selection_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transport_order_id uuid NOT NULL REFERENCES transport_orders(id) ON DELETE CASCADE,
  selected_vendor_id uuid NOT NULL REFERENCES vendors(id),
  selected_by_user_id uuid REFERENCES users(id),
  selection_method text NOT NULL,
  selection_reason text NOT NULL,
  selection_reason_note text,
  vendor_snapshot_response_rate_30d numeric(5,4),
  vendor_snapshot_decline_rate_30d numeric(5,4),
  vendor_snapshot_supported_stores integer,
  vendor_snapshot_supported_days integer,
  vendor_snapshot_recommendation_mark text,
  vendor_snapshot_is_new_vendor boolean NOT NULL DEFAULT false,
  considered_vendor_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE transport_orders
  ADD CONSTRAINT transport_orders_company_order_number_unique UNIQUE (company_id, order_number);

ALTER TABLE transport_orders
  ADD CONSTRAINT transport_orders_movement_type_check CHECK (movement_type IN ('one_way', 'round_trip', 'pickup_only', 'three_point'));

ALTER TABLE transport_orders
  ADD CONSTRAINT transport_orders_vendor_response_check CHECK (vendor_response IN ('pending', 'accepted', 'rejected'));

ALTER TABLE transport_orders
  ADD CONSTRAINT transport_orders_confirmation_mode_check CHECK (confirmation_mode IN ('auto', 'manual'));

ALTER TABLE transport_orders
  ADD CONSTRAINT transport_orders_movement_pattern_check
  CHECK (
    (movement_type = 'one_way' AND pickup_store_id IS NOT NULL AND delivery_store_id IS NOT NULL AND return_store_id IS NULL)
    OR
    (movement_type = 'round_trip' AND pickup_store_id IS NOT NULL AND delivery_store_id IS NOT NULL AND return_store_id IS NOT NULL)
    OR
    (movement_type = 'pickup_only' AND pickup_store_id IS NOT NULL AND delivery_store_id IS NULL AND return_store_id IS NULL)
    OR
    (movement_type = 'three_point' AND pickup_store_id IS NOT NULL AND delivery_store_id IS NOT NULL AND return_store_id IS NOT NULL
      AND pickup_store_id != delivery_store_id
      AND delivery_store_id != return_store_id
      AND pickup_store_id != return_store_id)
  );

ALTER TABLE transport_orders
  ADD CONSTRAINT transport_orders_tow_check CHECK ((NOT can_drive) = tow_required OR (can_drive AND NOT tow_required));

ALTER TABLE transport_order_vendor_attempts
  ADD CONSTRAINT transport_order_vendor_attempts_transport_order_attempt_seq_unique UNIQUE (transport_order_id, attempt_seq);

ALTER TABLE transport_order_vendor_attempts
  ADD CONSTRAINT transport_order_vendor_attempts_response_check CHECK (response IN ('pending', 'accepted', 'rejected', 'timeout'));

ALTER TABLE transport_order_invitations
  ADD CONSTRAINT transport_order_invitations_invitation_token_hash_unique UNIQUE (invitation_token_hash);

ALTER TABLE transport_order_invitations
  ADD CONSTRAINT transport_order_invitations_response_check CHECK (response IN ('pending', 'accepted', 'rejected', 'revoked', 'expired'));

ALTER TABLE transport_order_invitations
  ADD CONSTRAINT invitations_target_check CHECK (vendor_id IS NOT NULL OR invitee_email IS NOT NULL);

ALTER TABLE vendor_selection_logs
  ADD CONSTRAINT vendor_selection_logs_selection_method_check CHECK (selection_method IN ('manual', 'recommended', 'fallback', 'auto'));

ALTER TABLE vendor_selection_logs
  ADD CONSTRAINT vendor_selection_logs_selection_reason_check CHECK (selection_reason IN ('recommended_top', 'manual_preference', 'vendor_unavailable', 'customer_request', 'distance_priority', 'price_priority', 'other'));

ALTER TABLE vendor_selection_logs
  ADD CONSTRAINT vendor_selection_logs_recommendation_mark_check CHECK (vendor_snapshot_recommendation_mark IN ('◎', '○', '△', 'new_vendor') OR vendor_snapshot_recommendation_mark IS NULL);

ALTER TABLE vendor_selection_logs
  ADD CONSTRAINT vendor_selection_logs_no_update CHECK (true);

CREATE INDEX idx_transport_orders_vendor_status
  ON transport_orders (vendor_id, status_id);

CREATE INDEX idx_transport_orders_company_status
  ON transport_orders (company_id, status_id);

CREATE INDEX idx_transport_orders_pickup_store
  ON transport_orders (pickup_store_id);

CREATE INDEX idx_transport_orders_delivery_store
  ON transport_orders (delivery_store_id);

CREATE UNIQUE INDEX transport_order_invitations_winning_unique
  ON transport_order_invitations (transport_order_id)
  WHERE is_winning_bid = true;

CREATE UNIQUE INDEX transport_order_invitations_transport_order_vendor_unique
  ON transport_order_invitations (transport_order_id, vendor_id)
  WHERE vendor_id IS NOT NULL;

CREATE UNIQUE INDEX transport_order_invitations_transport_order_invitee_email_unique
  ON transport_order_invitations (transport_order_id, invitee_email)
  WHERE vendor_id IS NULL;

CREATE INDEX idx_transport_order_invitations_vendor_response
  ON transport_order_invitations (vendor_id, response);

CREATE INDEX idx_transport_order_invitations_transport_order
  ON transport_order_invitations (transport_order_id);

CREATE INDEX idx_vendor_selection_logs_transport_order
  ON vendor_selection_logs (transport_order_id, created_at DESC);

CREATE INDEX idx_vendor_selection_logs_vendor
  ON vendor_selection_logs (selected_vendor_id, created_at DESC);
