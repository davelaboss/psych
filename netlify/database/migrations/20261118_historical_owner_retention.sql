-- Schema only. This migration does NOT execute the historical correction.
ALTER TABLE fulfillment_batches DROP CONSTRAINT fulfillment_batches_status_check;
ALTER TABLE fulfillment_batches ADD CONSTRAINT fulfillment_batches_status_check
 CHECK (status IN ('OPEN','PREPARED','DELIVERED','LEGACY_FROZEN','CLOSED_OWNER_WITHDRAWAL'));
ALTER TABLE fulfillment_batch_events DROP CONSTRAINT fulfillment_batch_events_event_type_check;
ALTER TABLE fulfillment_batch_events ADD CONSTRAINT fulfillment_batch_events_event_type_check
 CHECK (event_type IN ('LEGACY_SNAPSHOT','PREPARE','DELIVER','REOPEN','COMBINE','SEPARATE','REVERSAL','OWNER_RETENTION'));

CREATE FUNCTION preserve_historical_owner_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN
   IF EXISTS (SELECT 1 FROM checkout_attempts WHERE order_snapshot ? 'ownerRetention') THEN
     RAISE EXCEPTION 'Owner-retention history is immutable';
   END IF;
   RETURN NULL;
 END IF;
 IF OLD.order_snapshot ? 'ownerRetention' AND
    (TG_OP='DELETE' OR NEW.order_snapshot IS DISTINCT FROM OLD.order_snapshot OR NEW.committed_at IS DISTINCT FROM OLD.committed_at) THEN
   RAISE EXCEPTION 'Owner-retention history is immutable';
 END IF;
 IF TG_OP='UPDATE' AND NEW.order_snapshot ? 'ownerRetention' AND NOT (OLD.order_snapshot ? 'ownerRetention') THEN
   IF NEW.order_id<>'VM-2026-514DA2AA' OR
      NEW.order_snapshot->'ownerRetention'->>'kind' IS DISTINCT FROM 'NO_CASH_OWNER_RETENTION' OR
      NEW.order_snapshot->'ownerRetention'->>'correctionId' IS DISTINCT FROM 'owner-retention-VM-2026-514DA2AA-v1' OR
      NEW.order_snapshot-'ownerRetention' IS DISTINCT FROM OLD.order_snapshot THEN
     RAISE EXCEPTION 'Historical retention must preserve the exact original order';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_retention_order BEFORE UPDATE OR DELETE ON checkout_attempts
 FOR EACH ROW EXECUTE FUNCTION preserve_historical_owner_retention();
CREATE TRIGGER preserve_retention_order_truncate BEFORE TRUNCATE ON checkout_attempts
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_historical_owner_retention();

CREATE FUNCTION preserve_closed_owner_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN
   IF EXISTS (SELECT 1 FROM fulfillment_batches WHERE status='CLOSED_OWNER_WITHDRAWAL') THEN
     RAISE EXCEPTION 'Closed owner-retention batch is immutable';
   END IF;
   RETURN NULL;
 END IF;
 IF OLD.status='CLOSED_OWNER_WITHDRAWAL' AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'Closed owner-retention batch is immutable';
 END IF;
 IF TG_OP='UPDATE' AND NEW.status='CLOSED_OWNER_WITHDRAWAL' AND OLD.status<>'CLOSED_OWNER_WITHDRAWAL' THEN
   IF NEW.fulfillment_batch_id<>'0d646d9f-80ae-4db5-acd6-bce66eca410a'::uuid OR OLD.status<>'PREPARED' OR
      NEW.delivered_at IS NOT NULL OR NEW.auto_attach OR NEW.merged_into_batch_id IS NOT NULL THEN
     RAISE EXCEPTION 'Invalid owner-retention closure';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_closed_retention_batch BEFORE UPDATE OR DELETE ON fulfillment_batches
 FOR EACH ROW EXECUTE FUNCTION preserve_closed_owner_batch();
CREATE TRIGGER preserve_closed_retention_batch_truncate BEFORE TRUNCATE ON fulfillment_batches
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_closed_owner_batch();

CREATE FUNCTION preserve_retention_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN
   IF EXISTS (SELECT 1 FROM fulfillment_batches WHERE status='CLOSED_OWNER_WITHDRAWAL') THEN
     RAISE EXCEPTION 'Owner-retention membership is immutable';
   END IF;
   RETURN NULL;
 END IF;
 IF EXISTS (SELECT 1 FROM fulfillment_batches WHERE status='CLOSED_OWNER_WITHDRAWAL' AND
   fulfillment_batch_id IN (CASE WHEN TG_OP<>'INSERT' THEN OLD.fulfillment_batch_id END,
                            CASE WHEN TG_OP<>'DELETE' THEN NEW.fulfillment_batch_id END)) THEN
   RAISE EXCEPTION 'Owner-retention membership is immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_retention_membership BEFORE INSERT OR UPDATE OR DELETE ON fulfillment_batch_items
 FOR EACH ROW EXECUTE FUNCTION preserve_retention_membership();
CREATE TRIGGER preserve_retention_membership_truncate BEFORE TRUNCATE ON fulfillment_batch_items
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_retention_membership();

CREATE FUNCTION preserve_retention_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN
   IF EXISTS (SELECT 1 FROM fulfillment_batch_events WHERE event_type='OWNER_RETENTION') THEN
     RAISE EXCEPTION 'Owner-retention audit is immutable';
   END IF;
   RETURN NULL;
 END IF;
 IF OLD.event_type='OWNER_RETENTION' THEN RAISE EXCEPTION 'Owner-retention audit is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_retention_audit BEFORE UPDATE OR DELETE ON fulfillment_batch_events
 FOR EACH ROW EXECUTE FUNCTION preserve_retention_audit();
CREATE TRIGGER preserve_retention_audit_truncate BEFORE TRUNCATE ON fulfillment_batch_events
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_retention_audit();
