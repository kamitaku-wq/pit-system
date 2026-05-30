CREATE TABLE pit_v24_poc.user_store_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES pit_v24_poc.users(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES pit_v24_poc.stores(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  deleted_at timestamptz
);

-- alpha-1: add membership role, primary store flag, effective dates.
