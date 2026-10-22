-- Apply once with the approved cleanup deployment, using the normal migration
-- process. David confirmed that one plant remains in addition to the paid unit.
-- Never reduce capacity, undo a commitment, or add capacity after a second sale.
UPDATE operational_inventory AS inventory
SET capacity = 2, updated_at = clock_timestamp()
WHERE inventory.product_id = 'real-20260828-31'
  AND inventory.capacity = 1
  AND inventory.committed_quantity = 1
  AND EXISTS (
    SELECT 1 FROM checkout_attempts AS attempt
    JOIN inventory_reservations AS reservation ON reservation.order_id = attempt.order_id
    WHERE attempt.order_id = 'VM-2026-042A512D'
      AND attempt.committed_at IS NOT NULL
      AND attempt.order_snapshot->>'status' <> 'CANCELLED'
      AND reservation.product_id = inventory.product_id
      AND reservation.phase = 'COMMITTED' AND reservation.quantity = 1
  );
