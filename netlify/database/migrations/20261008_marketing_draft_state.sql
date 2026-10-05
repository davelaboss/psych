ALTER TABLE marketing_email_packets
  DROP CONSTRAINT IF EXISTS marketing_email_packets_status_check;

ALTER TABLE marketing_email_packets
  ADD CONSTRAINT marketing_email_packets_status_check
  CHECK (status IN ('DRAFT','SENDING','SENT','FAILED','REPLACED'));

CREATE INDEX marketing_email_packets_current_draft
  ON marketing_email_packets (slot_date,slot_key,created_at DESC)
  WHERE status <> 'REPLACED';
