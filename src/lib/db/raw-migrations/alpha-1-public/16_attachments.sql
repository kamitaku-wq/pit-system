CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  service_ticket_id uuid REFERENCES service_tickets(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  transport_order_id uuid REFERENCES transport_orders(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  storage_bucket text NOT NULL,
  storage_key text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (storage_bucket, storage_key)
);

CREATE INDEX ix_attachments_service_ticket ON attachments(service_ticket_id) WHERE deleted_at IS NULL;
