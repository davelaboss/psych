import { inventoryTransaction } from './inventory-database.mjs';
import { queueOrderNotifications } from './seller-notifications.mjs';

export async function enqueueDueOrderReservationNotifications(limit = 20) {
  for (let i = 0; i < limit; i++) {
    const found = await inventoryTransaction(async client => {
      const event = (await client.query(`SELECT * FROM order_reservation_events
        WHERE due_at<=clock_timestamp() AND cancelled_at IS NULL AND processed_at IS NULL
        ORDER BY due_at,event_id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if (!event) return false;
      const orderRow = (await client.query(`SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE`,
        [event.order_id])).rows[0];
      const currentExpiration = orderRow?.expires_at && new Date(orderRow.expires_at).getTime();
      const matches = currentExpiration === new Date(event.reservation_expires_at).getTime();
      const stillUnpaid = orderRow && !orderRow.committed_at &&
        ['AWAITING_INITIAL_PAYMENT', 'RESERVATION_EXPIRED'].includes(orderRow.order_snapshot.status);
      const due = event.event_type === 'ORDER_RESERVATION_EXPIRING'
        ? currentExpiration > Date.now() : currentExpiration <= Date.now();
      if (matches && stillUnpaid && due) {
        await queueOrderNotifications(client, { key: `reservation:${event.event_id}`,
          order: orderRow.order_snapshot, type: event.event_type });
      }
      await client.query('UPDATE order_reservation_events SET processed_at=clock_timestamp() WHERE event_id=$1',
        [event.event_id]);
      return true;
    });
    if (!found) return;
  }
}
