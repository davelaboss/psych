CREATE TABLE pickup_windows (
  slot_key text PRIMARY KEY,
  capacity integer NOT NULL DEFAULT 4 CHECK (capacity = 4)
);

CREATE TABLE pickup_appointments (
  order_id text PRIMARY KEY REFERENCES checkout_attempts(order_id),
  slot_key text REFERENCES pickup_windows(slot_key),
  status text NOT NULL CHECK (status IN ('SCHEDULED', 'CANCELLED')),
  revision integer NOT NULL DEFAULT 1,
  changed_by text NOT NULL CHECK (changed_by IN ('CUSTOMER', 'ADMIN')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'SCHEDULED' AND slot_key IS NOT NULL) OR (status = 'CANCELLED' AND slot_key IS NULL))
);
CREATE INDEX pickup_appointments_upcoming ON pickup_appointments(slot_key) WHERE status = 'SCHEDULED';

CREATE TABLE seller_notifications (
  event_key text PRIMARY KEY,
  order_id text NOT NULL REFERENCES checkout_attempts(order_id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'RETRYABLE', 'UNCERTAIN')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX seller_notifications_ready ON seller_notifications(status, created_at);
