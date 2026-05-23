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

CREATE TABLE statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  domain text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, domain, code)
);

CREATE TABLE status_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  domain text NOT NULL,
  from_status_id uuid REFERENCES statuses(id) ON DELETE CASCADE,
  to_status_id uuid REFERENCES statuses(id) ON DELETE CASCADE,
  required_permission text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status_id IS DISTINCT FROM to_status_id)
);

CREATE INDEX ix_statuses_domain_code ON statuses(domain, code);
CREATE INDEX ix_status_transitions_from ON status_transitions(from_status_id);
