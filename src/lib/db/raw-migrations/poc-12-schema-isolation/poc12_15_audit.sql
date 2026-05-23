CREATE TABLE pit_v24_poc.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES pit_v24_poc.users(id) ON DELETE SET NULL,
  table_name text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- alpha-1: add action, row_id, request_id, ip_address, user_agent, redaction metadata.
