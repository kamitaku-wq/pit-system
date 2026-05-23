CREATE TABLE pit_v24_poc.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid,
  code text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid,
  role_id uuid REFERENCES pit_v24_poc.roles(id) ON DELETE CASCADE,
  code text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid,
  domain text NOT NULL,
  code text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE pit_v24_poc.status_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid,
  from_status_id uuid REFERENCES pit_v24_poc.statuses(id) ON DELETE CASCADE,
  to_status_id uuid REFERENCES pit_v24_poc.statuses(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- alpha-1: add role names, permission scopes, status display metadata, transition guards.
