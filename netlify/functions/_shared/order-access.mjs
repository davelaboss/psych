import { createHash } from 'node:crypto';

export function orderAccessToken(cartSessionId, orderId) {
  return createHash('sha256')
    .update(`psych-cart-order-access:${cartSessionId}:${orderId}`)
    .digest('hex');
}
