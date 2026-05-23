CREATE TABLE pit_v24_poc.service_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES pit_v24_poc.vehicles(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES pit_v24_poc.customers(id) ON DELETE SET NULL,
  store_id uuid REFERENCES pit_v24_poc.stores(id) ON DELETE SET NULL,
  status_id uuid REFERENCES pit_v24_poc.statuses(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- alpha-1: add work_category_id work_menu_id quoted_amount_minor tax_rate_bps billing_status.
