import { drainSellerNotifications } from './_shared/seller-notifications.mjs';
import { enqueueDueOrderReservationNotifications } from './_shared/order-reservation-notifications.mjs';

export const config = { schedule: '*/5 * * * *' };
export default async function handler() {
  await enqueueDueOrderReservationNotifications(20);
  await drainSellerNotifications(20);
  return new Response('ok');
}
