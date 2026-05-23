CREATE TABLE user_store_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to),
  UNIQUE (user_id, store_id)
);

CREATE INDEX ix_user_store_memberships_user ON user_store_memberships(user_id) WHERE deleted_at IS NULL;
