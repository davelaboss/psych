-- 20261010 is immutable because it has already run on deploy-preview databases.
-- Correct only timing keys that still match that migration's coercing backfill.
-- Existing timing-specific appointments already written by the application are left intact.
WITH timing_corrections AS (
  SELECT
    appointment.order_id,
    appointment.timing_key,
    COALESCE(delayed.original_timing_key, 'IMMEDIATE') AS original_timing_key,
    COALESCE(delayed.normalized_timing_key, 'IMMEDIATE') AS normalized_timing_key
  FROM pickup_appointments appointment
  LEFT JOIN LATERAL (
    SELECT
      'DELAYED:' ||
        COALESCE(NULLIF(btrim(item.value->>'pickupWindowStart', E' \t\r\n'), ''), 'UNSET') || ':' ||
        COALESCE(NULLIF(btrim(item.value->>'pickupWindowEnd', E' \t\r\n'), ''), 'UNSET')
        AS original_timing_key,
      'DELAYED:' ||
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
        AS normalized_timing_key
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
  ) delayed ON true
)
UPDATE pickup_appointments appointment
SET timing_key = correction.normalized_timing_key
FROM timing_corrections correction
WHERE appointment.order_id = correction.order_id
  AND appointment.timing_key = correction.timing_key
  AND appointment.timing_key = correction.original_timing_key
  AND correction.original_timing_key <> correction.normalized_timing_key
  AND NOT EXISTS (
    SELECT 1
    FROM pickup_appointments existing
    WHERE existing.order_id = appointment.order_id
      AND existing.timing_key = correction.normalized_timing_key
      AND existing.timing_key <> appointment.timing_key
  );
