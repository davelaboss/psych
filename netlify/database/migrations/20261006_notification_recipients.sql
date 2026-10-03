ALTER TABLE seller_notifications
  ADD COLUMN recipient_role text NOT NULL DEFAULT 'SELLER'
    CHECK (recipient_role IN ('SELLER', 'CUSTOMER')),
  ADD COLUMN recipient_email text,
  ADD COLUMN sender_email text,
  ADD COLUMN subject text,
  ADD COLUMN message text;

CREATE INDEX seller_notifications_order_event
  ON seller_notifications(order_id, event_type, recipient_role);
