CREATE TABLE service_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  status_id uuid REFERENCES statuses(id) ON DELETE SET NULL,
  work_category_id uuid REFERENCES work_categories(id) ON DELETE SET NULL,
  work_menu_id uuid REFERENCES work_menus(id) ON DELETE SET NULL,
  ticket_no text,
  quoted_amount_minor integer NOT NULL DEFAULT 0 CHECK (quoted_amount_minor >= 0),
  tax_rate_bps integer NOT NULL DEFAULT 1000 CHECK (tax_rate_bps >= 0),
  billing_status text NOT NULL DEFAULT 'unbilled' CHECK (billing_status IN ('unbilled', 'quoted', 'billed', 'paid', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, ticket_no)
);

CREATE INDEX ix_service_tickets_company_status ON service_tickets(company_id, status_id);
