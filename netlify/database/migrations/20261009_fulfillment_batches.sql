CREATE TABLE fulfillment_batches (
  fulfillment_batch_id uuid PRIMARY KEY,
  buyer_group_id uuid NOT NULL REFERENCES buyer_groups(buyer_group_id),
  timing_key text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'OPEN',
    'PREPARED',
    'DELIVERED',
    'LEGACY_FROZEN'
  )),
  auto_attach boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  prepared_at timestamptz,
  delivered_at timestamptz,
  merged_into_batch_id uuid REFERENCES fulfillment_batches(fulfillment_batch_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT auto_attach OR (status = 'OPEN' AND merged_into_batch_id IS NULL)),
  CHECK (merged_into_batch_id IS NULL OR merged_into_batch_id <> fulfillment_batch_id)
);

CREATE UNIQUE INDEX fulfillment_batches_auto_open
  ON fulfillment_batches(buyer_group_id, timing_key)
  WHERE status = 'OPEN'
    AND auto_attach = true
    AND merged_into_batch_id IS NULL;

CREATE INDEX fulfillment_batches_buyer
  ON fulfillment_batches(buyer_group_id, timing_key, created_at);

CREATE TABLE fulfillment_batch_items (
  order_id text NOT NULL REFERENCES checkout_attempts(order_id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  fulfillment_batch_id uuid NOT NULL REFERENCES fulfillment_batches(fulfillment_batch_id),
  assignment_mode text NOT NULL CHECK (assignment_mode IN (
    'LEGACY_BACKFILL',
    'AUTO_NEW',
    'AUTO_MATCH',
    'MANUAL_COMBINE',
    'MANUAL_SEPARATE'
  )),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX fulfillment_batch_items_batch
  ON fulfillment_batch_items(fulfillment_batch_id, order_id, product_id);

CREATE TABLE fulfillment_batch_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'LEGACY_SNAPSHOT',
    'PREPARE',
    'DELIVER',
    'REOPEN',
    'COMBINE',
    'SEPARATE',
    'REVERSAL'
  )),
  fulfillment_batch_id uuid REFERENCES fulfillment_batches(fulfillment_batch_id),
  source_batch_id uuid REFERENCES fulfillment_batches(fulfillment_batch_id),
  target_batch_id uuid REFERENCES fulfillment_batches(fulfillment_batch_id),
  actor text NOT NULL DEFAULT 'ADMIN',
  affected_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  revisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX fulfillment_batch_events_batch
  ON fulfillment_batch_events(fulfillment_batch_id, created_at);

WITH legacy_items AS (
  SELECT
    membership.buyer_group_id,
    attempt.order_id,
    item.value AS item,
    normalized_item.product_id,
    CASE
      WHEN upper(CASE
        WHEN jsonb_typeof(item.value->'saleMode') = 'string'
          THEN btrim(item.value->>'saleMode', E' \t\r\n')
        ELSE 'IMMEDIATE'
      END) = 'DELAYED'
        THEN 'DELAYED:' ||
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
      ELSE 'IMMEDIATE'
    END AS timing_key
  FROM buyer_group_orders membership
  JOIN checkout_attempts attempt USING (order_id)
  CROSS JOIN LATERAL jsonb_array_elements(CASE
    WHEN jsonb_typeof(attempt.order_snapshot->'items') = 'array'
      THEN attempt.order_snapshot->'items'
    ELSE '[]'::jsonb
  END) item(value)
  CROSS JOIN LATERAL (SELECT CASE
    WHEN jsonb_typeof(item.value->'productId') = 'string'
      THEN btrim(item.value->>'productId', E' \t\r\n')
    ELSE ''
  END AS product_id) normalized_item
  WHERE attempt.committed_at IS NOT NULL
    AND COALESCE(attempt.order_snapshot->>'status', '') <> 'CANCELLED'
    AND normalized_item.product_id <> ''
), legacy_batches AS (
  SELECT DISTINCT
    md5('legacy:' || buyer_group_id::text || ':' || timing_key)::uuid AS fulfillment_batch_id,
    buyer_group_id,
    timing_key
  FROM legacy_items
), inserted_batches AS (
  INSERT INTO fulfillment_batches (
    fulfillment_batch_id,
    buyer_group_id,
    timing_key,
    status,
    auto_attach
  )
  SELECT
    fulfillment_batch_id,
    buyer_group_id,
    timing_key,
    'LEGACY_FROZEN',
    false
  FROM legacy_batches
  ON CONFLICT (fulfillment_batch_id) DO NOTHING
  RETURNING fulfillment_batch_id, buyer_group_id, timing_key, revision
), inserted_items AS (
  INSERT INTO fulfillment_batch_items (
    order_id,
    product_id,
    fulfillment_batch_id,
    assignment_mode
  )
  SELECT
    legacy.order_id,
    legacy.product_id,
    batch.fulfillment_batch_id,
    'LEGACY_BACKFILL'
  FROM legacy_items legacy
  JOIN inserted_batches batch
    ON batch.buyer_group_id = legacy.buyer_group_id
    AND batch.timing_key = legacy.timing_key
  ON CONFLICT (order_id, product_id) DO NOTHING
  RETURNING fulfillment_batch_id, order_id, product_id
)
INSERT INTO fulfillment_batch_events (
  event_type,
  fulfillment_batch_id,
  target_batch_id,
  actor,
  affected_items,
  revisions,
  context
)
SELECT
  'LEGACY_SNAPSHOT',
  batch.fulfillment_batch_id,
  batch.fulfillment_batch_id,
  'MIGRATION',
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('orderId', item.order_id, 'productId', item.product_id)
      ORDER BY item.order_id, item.product_id
    )
    FROM inserted_items item
    WHERE item.fulfillment_batch_id = batch.fulfillment_batch_id
  ), '[]'::jsonb),
  jsonb_build_object('targetRevision', batch.revision),
  jsonb_build_object('reason', 'CURRENT_BUYER_GROUP_SNAPSHOT')
FROM inserted_batches batch;
