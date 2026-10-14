-- Pickup appointments now belong to a fulfillment timing part, not to a whole order.
-- Legacy behavior treated any order containing a delayed item as delayed. Preserve that
-- intent by attaching each existing appointment to the first delayed timing key in the
-- stored item order; immediate-only orders are backfilled as IMMEDIATE.
ALTER TABLE pickup_appointments ADD COLUMN IF NOT EXISTS timing_key text;

UPDATE pickup_appointments appointment
SET timing_key = COALESCE((
  SELECT 'DELAYED:' ||
    CASE
      WHEN jsonb_typeof(item.value->'pickupWindowStart') = 'string'
        THEN COALESCE(NULLIF(btrim(item.value->>'pickupWindowStart', E' \t\r\n'), ''), 'UNSET')
      ELSE 'UNSET'
    END || ':' ||
    CASE
      WHEN jsonb_typeof(item.value->'pickupWindowEnd') = 'string'
        THEN COALESCE(NULLIF(btrim(item.value->>'pickupWindowEnd', E' \t\r\n'), ''), 'UNSET')
      ELSE 'UNSET'
    END
  FROM checkout_attempts attempt
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(attempt.order_snapshot->'items') = 'array'
      THEN attempt.order_snapshot->'items' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS item(value, ordinal)
  WHERE attempt.order_id = appointment.order_id
    AND upper(CASE
      WHEN jsonb_typeof(item.value->'saleMode') = 'string'
        THEN btrim(item.value->>'saleMode', E' \t\r\n')
      ELSE 'IMMEDIATE'
    END) = 'DELAYED'
  ORDER BY item.ordinal
  LIMIT 1
), 'IMMEDIATE')
WHERE timing_key IS NULL;

ALTER TABLE pickup_appointments ALTER COLUMN timing_key SET NOT NULL;
ALTER TABLE pickup_appointments ADD CONSTRAINT pickup_appointments_timing_key_nonempty
  CHECK (length(btrim(timing_key)) > 0);
ALTER TABLE pickup_appointments DROP CONSTRAINT pickup_appointments_pkey;
ALTER TABLE pickup_appointments ADD PRIMARY KEY (order_id, timing_key);

CREATE INDEX IF NOT EXISTS pickup_appointments_order
  ON pickup_appointments(order_id);
