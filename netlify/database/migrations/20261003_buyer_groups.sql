CREATE TABLE buyer_groups (
  buyer_group_id uuid PRIMARY KEY,
  display_name text NOT NULL,
  display_phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE buyer_group_orders (
  order_id text PRIMARY KEY REFERENCES checkout_attempts(order_id) ON DELETE CASCADE,
  buyer_group_id uuid NOT NULL REFERENCES buyer_groups(buyer_group_id) ON DELETE CASCADE,
  normalized_name text NOT NULL,
  normalized_phone text NOT NULL,
  assignment_mode text NOT NULL CHECK (assignment_mode IN (
    'AUTO_NEW',
    'AUTO_MATCH',
    'AUTO_AMBIGUOUS',
    'MANUAL_MERGE',
    'MANUAL_SEPARATE'
  )),
  auto_match_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX buyer_group_orders_group
  ON buyer_group_orders(buyer_group_id);

CREATE INDEX buyer_group_orders_signature
  ON buyer_group_orders(normalized_name, normalized_phone)
  WHERE auto_match_blocked = false;
