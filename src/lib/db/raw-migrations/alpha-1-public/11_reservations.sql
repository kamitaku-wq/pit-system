CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  service_ticket_id uuid REFERENCES service_tickets(id) ON DELETE SET NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  lane_id uuid NOT NULL REFERENCES lanes(id) ON DELETE RESTRICT,
  work_menu_id uuid REFERENCES work_menus(id) ON DELETE SET NULL,
  status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  duration_minutes integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT reservations_time_order_check CHECK (start_at < end_at),
  CONSTRAINT reservations_no_overlap EXCLUDE USING gist (
    store_id WITH =,
    lane_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (deleted_at IS NULL)
);

CREATE TABLE reservation_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  from_status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_reservation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (token_hash)
);

CREATE INDEX ix_reservations_lane_time ON reservations(lane_id, start_at, end_at) WHERE deleted_at IS NULL;
