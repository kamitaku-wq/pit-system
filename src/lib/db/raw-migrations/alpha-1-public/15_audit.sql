CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_vendor_user_id uuid REFERENCES vendor_users(id) ON DELETE SET NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'vendor_user', 'customer', 'system')),
  before_json jsonb,
  after_json jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX ix_audit_logs_actor ON audit_logs(actor_user_id, created_at);
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;
