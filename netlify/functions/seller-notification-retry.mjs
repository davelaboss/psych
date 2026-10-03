import { drainSellerNotifications } from './_shared/seller-notifications.mjs';

export const config = { schedule: '*/5 * * * *' };
export default async function handler() {
  await drainSellerNotifications(20);
  return new Response('ok');
}
