CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  full_name text NOT NULL,
  full_name_kana text,
  email text,
  phone text,
  postal_code text,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  vin text,
  registration_number text,
  maker text,
  model text,
  model_year integer,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE vehicle_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ends_on date,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_on IS NULL OR starts_on <= ends_on)
);

CREATE INDEX ix_customers_company_name ON customers(company_id, full_name) WHERE deleted_at IS NULL;
CREATE INDEX ix_vehicles_company_plate ON vehicles(company_id, registration_number) WHERE deleted_at IS NULL;
