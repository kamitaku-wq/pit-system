CREATE TABLE pit_v24_poc.reservation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  store_id uuid REFERENCES pit_v24_poc.stores(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- alpha-1: add slot interval, lead time, cancellation policy, buffer minutes.
