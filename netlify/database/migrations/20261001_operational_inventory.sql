CREATE TABLE operational_inventory (
  product_id text PRIMARY KEY,
  capacity integer NOT NULL CHECK (capacity >= 0),
  committed_quantity integer NOT NULL DEFAULT 0 CHECK (committed_quantity >= 0 AND committed_quantity <= capacity),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE cart_sessions (
  session_id uuid PRIMARY KEY,
  generation integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  expired_at timestamptz
);

CREATE TABLE checkout_attempts (
  order_id text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES cart_sessions(session_id),
  checkout_id uuid NOT NULL,
  cart_generation integer NOT NULL,
  request_fingerprint text NOT NULL,
  order_snapshot jsonb NOT NULL,
  expires_at timestamptz,
  committed_at timestamptz,
  projection_version integer NOT NULL DEFAULT 1,
  blob_synced_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (session_id, checkout_id),
  UNIQUE (session_id, cart_generation)
);

CREATE TABLE inventory_reservations (
  reservation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id text NOT NULL REFERENCES operational_inventory(product_id),
  session_id uuid NOT NULL REFERENCES cart_sessions(session_id),
  quantity integer NOT NULL CHECK (quantity > 0),
  phase text NOT NULL CHECK (phase IN ('CART', 'ORDER', 'COMMITTED')),
  order_id text REFERENCES checkout_attempts(order_id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((phase = 'CART' AND order_id IS NULL AND expires_at IS NOT NULL)
    OR (phase IN ('ORDER', 'COMMITTED') AND order_id IS NOT NULL))
);
CREATE UNIQUE INDEX reservation_cart_owner ON inventory_reservations(session_id, product_id) WHERE phase = 'CART';
CREATE UNIQUE INDEX reservation_order_product ON inventory_reservations(order_id, product_id) WHERE order_id IS NOT NULL;
CREATE INDEX reservation_product_phase ON inventory_reservations(product_id, phase);

-- A cross-row capacity invariant cannot be expressed as a plain CHECK.
-- Transactions lock products before writing; this deferred guard validates
-- the final state, including the ORDER -> COMMITTED counter conversion.
CREATE FUNCTION enforce_inventory_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  product text;
  source_capacity integer;
  committed integer;
  reserved bigint;
BEGIN
  FOR product IN
    SELECT DISTINCT value FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.product_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.product_id END
    ]) AS value WHERE value IS NOT NULL ORDER BY value
  LOOP
    SELECT capacity, committed_quantity INTO source_capacity, committed
      FROM operational_inventory WHERE product_id = product FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT COALESCE(sum(quantity), 0) INTO reserved FROM inventory_reservations
      WHERE product_id = product
        AND ((phase = 'CART' AND expires_at > clock_timestamp())
          OR (phase = 'ORDER' AND (expires_at IS NULL OR expires_at > clock_timestamp())));
    IF committed + reserved > source_capacity THEN
      RAISE EXCEPTION 'Inventory capacity exceeded for %', product USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER reservations_capacity_guard
  AFTER INSERT OR UPDATE OR DELETE ON inventory_reservations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_inventory_capacity();
CREATE CONSTRAINT TRIGGER product_capacity_guard
  AFTER INSERT OR UPDATE ON operational_inventory
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_inventory_capacity();
