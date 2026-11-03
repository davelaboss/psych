-- Additive only: never rewrite existing appointments, orders or notifications.
CREATE TABLE pickup_blackouts (
  id uuid PRIMARY KEY,
  pickup_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (start_time < end_time),
  CHECK (extract(second FROM start_time) = 0 AND extract(second FROM end_time) = 0)
);
CREATE INDEX pickup_blackouts_date ON pickup_blackouts(pickup_date);
