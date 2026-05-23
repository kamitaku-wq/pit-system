CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  code text UNIQUE,
  name text NOT NULL,
  time_zone text NOT NULL DEFAULT 'Asia/Tokyo',
  default_currency text NOT NULL DEFAULT 'JPY',
  is_active boolean NOT NULL DEFAULT true,
  plan text NOT NULL DEFAULT 'standard',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX ix_companies_active ON companies(is_active) WHERE deleted_at IS NULL;
