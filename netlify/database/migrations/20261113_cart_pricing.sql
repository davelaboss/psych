-- Additive only. Existing orders, reservations and prices are never rewritten.
ALTER TABLE inventory_reservations ADD COLUMN pricing_snapshot jsonb;
