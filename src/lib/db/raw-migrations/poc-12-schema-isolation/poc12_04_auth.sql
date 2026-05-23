CREATE TABLE pit_v24_poc.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  role_id uuid REFERENCES pit_v24_poc.roles(id) ON DELETE SET NULL,
  email text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  deleted_at timestamptz
);

-- alpha-1: add columns name default_store_id is_active last_login_at.
