CREATE TABLE marketing_email_packets (
  id text PRIMARY KEY,
  slot_date date NOT NULL,
  slot_key text NOT NULL CHECK (slot_key IN (
    'MONDAY_AM','MONDAY_PM','TUESDAY_AM','TUESDAY_PM','WEDNESDAY_AM',
    'WEDNESDAY_PM','THURSDAY_AM','THURSDAY_PM','FRIDAY_AM','FRIDAY_PM'
  )),
  selection_seed text NOT NULL,
  selected_products jsonb NOT NULL CHECK (jsonb_typeof(selected_products) = 'array'),
  subject text NOT NULL,
  social_copy text NOT NULL,
  html_body text NOT NULL,
  text_body text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENDING','SENT','FAILED')),
  idempotency_key text NOT NULL UNIQUE,
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX marketing_email_packets_recent
  ON marketing_email_packets (slot_date DESC, created_at DESC);

CREATE TABLE marketing_email_send_slots (
  slot_date date NOT NULL,
  slot_key text NOT NULL,
  packet_id text NOT NULL REFERENCES marketing_email_packets(id),
  status text NOT NULL CHECK (status IN ('SENDING','SENT','FAILED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (slot_date, slot_key)
);

CREATE TABLE marketing_email_features (
  packet_id text NOT NULL REFERENCES marketing_email_packets(id),
  product_id text NOT NULL,
  featured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (packet_id, product_id)
);

CREATE INDEX marketing_email_features_rotation
  ON marketing_email_features (product_id, featured_at DESC);
