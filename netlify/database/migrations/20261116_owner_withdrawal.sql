-- Development only. No historical backfill or changes to stock/financial records.
ALTER TABLE operational_inventory ADD COLUMN owner_withdrawal jsonb;
ALTER TABLE operational_inventory ADD CONSTRAINT owner_withdrawal_evidence CHECK (
  owner_withdrawal IS NULL OR (
    jsonb_typeof(owner_withdrawal) = 'object'
    AND owner_withdrawal->>'action' = 'OWNER_WITHDRAWAL'
    AND owner_withdrawal->>'actor' = 'OWNER'
    AND owner_withdrawal->>'productId' = product_id
    AND owner_withdrawal ? 'recordedAt'
    AND owner_withdrawal ? 'product'
  ) IS TRUE
);
CREATE FUNCTION preserve_owner_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM operational_inventory WHERE owner_withdrawal IS NOT NULL) THEN
      RAISE EXCEPTION 'Owner withdrawal audit evidence is immutable';
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.owner_withdrawal IS NOT NULL AND
    (TG_OP = 'DELETE' OR NEW.owner_withdrawal IS DISTINCT FROM OLD.owner_withdrawal) THEN
    RAISE EXCEPTION 'Owner withdrawal audit evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_owner_withdrawal_evidence BEFORE UPDATE OR DELETE ON operational_inventory
  FOR EACH ROW EXECUTE FUNCTION preserve_owner_withdrawal();
CREATE TRIGGER preserve_owner_withdrawal_on_truncate BEFORE TRUNCATE ON operational_inventory
  FOR EACH STATEMENT EXECUTE FUNCTION preserve_owner_withdrawal();
