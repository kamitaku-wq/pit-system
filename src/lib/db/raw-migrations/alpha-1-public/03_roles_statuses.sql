CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE CASCADE,
  code text NOT NULL,
  resource text,
  action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, code)
);

DROP TABLE IF EXISTS status_transitions CASCADE;
DROP TABLE IF EXISTS statuses CASCADE;

CREATE TABLE statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  status_type text NOT NULL CHECK (status_type IN ('reservation', 'service', 'transport', 'vendor')),
  key text NOT NULL,
  name text NOT NULL,
  display_order integer,
  is_initial boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  is_active boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, status_type, key)
);

CREATE TABLE status_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  status_type text NOT NULL,
  from_status_id uuid REFERENCES statuses(id),
  to_status_id uuid NOT NULL REFERENCES statuses(id),
  required_permission_key text,
  required_role_key text,
  triggers_notification boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, status_type, from_status_id, to_status_id)
);
