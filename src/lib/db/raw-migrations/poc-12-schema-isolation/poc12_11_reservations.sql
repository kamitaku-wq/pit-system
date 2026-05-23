CREATE TABLE pit_v24_poc.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES pit_v24_poc.stores(id) ON DELETE RESTRICT,
  lane_id uuid NOT NULL REFERENCES pit_v24_poc.lanes(id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT reservations_time_order_check CHECK (start_at < end_at),
  CONSTRAINT reservations_no_overlap EXCLUDE USING gist (
    store_id WITH =,
    lane_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  )
);

CREATE TABLE pit_v24_poc.reservation_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES pit_v24_poc.reservations(id) ON DELETE CASCADE,
  status_id uuid REFERENCES pit_v24_poc.statuses(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES pit_v24_poc.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.customer_reservation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES pit_v24_poc.reservations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES pit_v24_poc.customers(id) ON DELETE SET NULL,
  token_hash text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  deleted_at timestamptz
);

-- alpha-1: add reservation service_ticket_id work_menu_id status_id duration notes customer-facing token expiry.
