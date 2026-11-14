-- Preparation only: requires a separately authorized production migration.
-- No backfill, snapshot rewrite, historical allocation, or appointment mutation.
CREATE TABLE item_payment_decisions (
  id uuid PRIMARY KEY,
  order_id text NOT NULL REFERENCES checkout_attempts(order_id),
  kind text NOT NULL CHECK (kind IN ('ALLOCATE','REVERSE','REQUIREMENT','REVOKE')),
  product_id text,
  payment_id text,
  amount_pyg bigint CHECK (amount_pyg > 0 AND amount_pyg <= 9007199254740991),
  scheduling_required_pyg bigint CHECK (scheduling_required_pyg >= 0 AND scheduling_required_pyg <= 9007199254740991),
  collection_required_pyg bigint CHECK (collection_required_pyg >= scheduling_required_pyg AND collection_required_pyg <= 9007199254740991),
  reverses_id uuid UNIQUE REFERENCES item_payment_decisions(id),
  actor text NOT NULL CHECK (actor = 'ADMIN'),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (kind='ALLOCATE' AND product_id IS NOT NULL AND payment_id IS NOT NULL AND amount_pyg IS NOT NULL AND reverses_id IS NULL AND scheduling_required_pyg IS NULL AND collection_required_pyg IS NULL) OR
    (kind='REQUIREMENT' AND product_id IS NOT NULL AND payment_id IS NULL AND amount_pyg IS NULL AND reverses_id IS NULL AND scheduling_required_pyg IS NOT NULL AND collection_required_pyg IS NOT NULL) OR
    (kind IN ('REVERSE','REVOKE') AND reverses_id IS NOT NULL AND product_id IS NULL AND payment_id IS NULL AND amount_pyg IS NULL AND scheduling_required_pyg IS NULL AND collection_required_pyg IS NULL)
  )
);
CREATE INDEX item_payment_decisions_order ON item_payment_decisions(order_id,created_at,id);
CREATE FUNCTION reject_item_payment_decision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Item payment decisions are append-only'; END $$;
CREATE TRIGGER item_payment_decisions_append_only BEFORE UPDATE OR DELETE ON item_payment_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_item_payment_decision_mutation();
CREATE TRIGGER item_payment_decisions_no_truncate BEFORE TRUNCATE ON item_payment_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_item_payment_decision_mutation();

-- NULL preserves the legacy membership: all Items in the stored timing group.
-- Only an explicitly requested new booking/change writes membership.
ALTER TABLE pickup_appointments ADD COLUMN item_ids text[];
ALTER TABLE pickup_appointments ADD CONSTRAINT pickup_item_membership_nonempty
  CHECK (item_ids IS NULL OR cardinality(item_ids)>0);
