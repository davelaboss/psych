CREATE TABLE order_reservation_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL REFERENCES checkout_attempts(order_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'ORDER_RESERVATION_EXPIRING',
    'ORDER_RESERVATION_EXPIRED'
  )),
  reservation_expires_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_at timestamptz,
  processed_at timestamptz,
  UNIQUE (order_id, event_type, reservation_expires_at)
);

CREATE INDEX order_reservation_events_due
  ON order_reservation_events(due_at)
  WHERE cancelled_at IS NULL AND processed_at IS NULL;
