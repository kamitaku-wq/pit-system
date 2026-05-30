CREATE TABLE pit_v24_poc.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL REFERENCES pit_v24_poc.companies(id) ON DELETE RESTRICT,
  service_ticket_id uuid REFERENCES pit_v24_poc.service_tickets(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES pit_v24_poc.reservations(id) ON DELETE CASCADE,
  transport_order_id uuid REFERENCES pit_v24_poc.transport_orders(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  deleted_at timestamptz
);

-- alpha-1: add storage key, file name, content type, byte size, checksum.
