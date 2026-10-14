CREATE TABLE sale_analytics_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL CHECK (event_type IN (
    'CATALOG_VISIT',
    'CATEGORY_SELECT',
    'SEARCH',
    'FILTER_APPLY',
    'PRODUCT_VIEW',
    'ADD_TO_CART'
  )),
  anonymous_session_hash text,
  product_id text,
  campaign_source text NOT NULL DEFAULT 'direct' CHECK (campaign_source IN (
    'story',
    'jw-group',
    'direct'
  )),
  category text,
  search_term text,
  filter_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_position integer CHECK (result_position IS NULL OR result_position > 0),
  result_count integer CHECK (result_count IS NULL OR result_count >= 0),
  CHECK (anonymous_session_hash IS NULL OR anonymous_session_hash ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(filter_context) = 'object')
);

CREATE INDEX sale_analytics_occurred_at
  ON sale_analytics_events(occurred_at);

CREATE INDEX sale_analytics_type_occurred_at
  ON sale_analytics_events(event_type, occurred_at);

CREATE INDEX sale_analytics_product_occurred_at
  ON sale_analytics_events(product_id, occurred_at)
  WHERE product_id IS NOT NULL;

CREATE INDEX sale_analytics_session_occurred_at
  ON sale_analytics_events(anonymous_session_hash, occurred_at)
  WHERE anonymous_session_hash IS NOT NULL;

CREATE INDEX sale_analytics_source_occurred_at
  ON sale_analytics_events(campaign_source, occurred_at);
