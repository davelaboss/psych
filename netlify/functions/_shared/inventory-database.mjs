import { getDatabase } from '@netlify/database';
import { createHash } from 'node:crypto';
import { withPaymentState } from './order-payments.mjs';
import { queueSellerNotification } from './seller-notifications.mjs';

const RESERVED = 'Este artículo está temporalmente reservado por otro comprador.';
const EXPIRED = 'La reserva temporal venció y este artículo volvió a estar disponible.';
const INITIAL_CART_TTL = 35 * 60 * 1000;
const CART_EXTENSION = 20 * 60 * 1000;
const MAX_CART_TTL = 55 * 60 * 1000;
const ms = value => value == null ? null : new Date(value).getTime();
const fail = message => Object.assign(new Error(message), { status: 409 });
let databaseClient;
export const database = () => databaseClient ||= getDatabase();

export async function inventoryTransaction(operation) {
  for (let retry = 0; retry < 3; retry++) {
    const client = await database().pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (['40P01', '40001'].includes(error.code) && retry < 2) continue;
      if (error.code === '23514') throw fail(RESERVED);
      throw error;
    } finally { client.release(); }
  }
}

async function sessionLock(client, sessionId) {
  await client.query('INSERT INTO cart_sessions(session_id) VALUES ($1) ON CONFLICT DO NOTHING', [sessionId]);
  return (await client.query('SELECT * FROM cart_sessions WHERE session_id=$1 FOR UPDATE', [sessionId])).rows[0];
}
async function cartRows(client, sessionId) {
  return (await client.query("SELECT * FROM inventory_reservations WHERE session_id=$1 AND phase='CART' ORDER BY product_id", [sessionId])).rows;
}
async function now(client) { return ms((await client.query('SELECT clock_timestamp() AS now')).rows[0].now); }

async function productLocks(client, ids, capacities = {}) {
  for (const id of [...new Set(ids)].sort()) {
    if (Object.hasOwn(capacities, id)) {
      await client.query('INSERT INTO operational_inventory(product_id,capacity) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, Math.max(0, Math.floor(Number(capacities[id]) || 0))]);
    }
    const row = (await client.query('SELECT * FROM operational_inventory WHERE product_id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw fail('No encontramos el inventario de este artículo.');
  }
}
async function expireCart(client, session, timestamp) {
  if (session.expires_at && ms(session.expires_at) <= timestamp) {
    await client.query("DELETE FROM inventory_reservations WHERE session_id=$1 AND phase='CART'", [session.session_id]);
    await client.query('UPDATE cart_sessions SET expired_at=expires_at,expires_at=NULL WHERE session_id=$1', [session.session_id]);
    session.expired_at = session.expires_at;
    session.expires_at = null;
  }
}
async function leaseStatus(client, session) {
  const items = await cartRows(client, session.session_id);
  return { lease: items.length ? { createdAt: ms(session.created_at), expiresAt: ms(session.expires_at),
    extensionUsed: Boolean(session.extension_used_at), extensionUsedAt: ms(session.extension_used_at),
    items: Object.fromEntries(items.map(row => [row.product_id, row.quantity])) } : null,
  expiredAt: ms(session.expired_at) };
}
async function available(client, productId, sessionId) {
  const { rows } = await client.query(`SELECT p.capacity-p.committed_quantity-COALESCE((
    SELECT sum(r.quantity) FROM inventory_reservations r WHERE r.product_id=p.product_id
      AND ((r.phase='CART' AND r.expires_at>clock_timestamp() AND r.session_id<>$2::uuid)
        OR (r.phase='ORDER' AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())))
  ),0) AS available FROM operational_inventory p WHERE p.product_id=$1`, [productId, sessionId]);
  return Number(rows[0]?.available || 0);
}

export async function getCartLeaseStatus(sessionId) {
  return inventoryTransaction(async client => {
    const session = await sessionLock(client, sessionId);
    const rows = await cartRows(client, sessionId);
    await productLocks(client, rows.map(row => row.product_id));
    await expireCart(client, session, await now(client));
    const status = await leaseStatus(client, session);
    if (!status.lease) {
      const pending = (await client.query(`SELECT a.order_id FROM checkout_attempts a
        WHERE a.session_id=$1 AND a.cart_generation=$2 AND a.committed_at IS NULL
          AND a.order_snapshot->>'status' <> 'CANCELLED'
          AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp())`, [sessionId, session.generation])).rows[0];
      if (pending) status.pendingOrderId = pending.order_id;
    }
    return status;
  });
}
async function setCartQuantity({ cartSessionId, productId, quantity, availability }, allowNew) {
  return inventoryTransaction(async client => {
    const session = await sessionLock(client, cartSessionId);
    const rows = await cartRows(client, cartSessionId);
    await productLocks(client, [...rows.map(row => row.product_id), productId], { [productId]: availability });
    const timestamp = await now(client);
    await expireCart(client, session, timestamp);
    if (!session.expires_at) {
      if (!allowNew || quantity <= 0) return leaseStatus(client, session);
      session.created_at = new Date(timestamp);
      session.expires_at = new Date(timestamp + INITIAL_CART_TTL);
      session.expired_at = null;
      session.extension_used_at = null;
      await client.query('UPDATE cart_sessions SET generation=generation+1,created_at=$2,expires_at=$3,expired_at=NULL,extension_used_at=NULL WHERE session_id=$1',
        [cartSessionId, session.created_at, session.expires_at]);
    }
    if (quantity > 0) {
      if ((await available(client, productId, cartSessionId)) < quantity) throw fail(RESERVED);
      await client.query(`INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,expires_at)
        VALUES ($1,$2,$3,'CART',$4) ON CONFLICT(session_id,product_id) WHERE phase='CART'
        DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=clock_timestamp()`,
      [productId, cartSessionId, quantity, session.expires_at]);
    } else {
      await client.query("DELETE FROM inventory_reservations WHERE session_id=$1 AND product_id=$2 AND phase='CART'", [cartSessionId, productId]);
    }
    if (!(await cartRows(client, cartSessionId)).length) {
      await client.query('UPDATE cart_sessions SET expires_at=NULL WHERE session_id=$1', [cartSessionId]);
      session.expires_at = null;
    }
    return leaseStatus(client, session);
  });
}
export async function claimCartLease(args) { return (await setCartQuantity(args, true)).lease; }
export async function updateCartLease(args) { return setCartQuantity(args, false); }
export async function releaseCartLease(sessionId) {
  return inventoryTransaction(async client => {
    const session = await sessionLock(client, sessionId);
    const rows = await cartRows(client, sessionId);
    await productLocks(client, rows.map(row => row.product_id));
    await client.query("DELETE FROM inventory_reservations WHERE session_id=$1 AND phase='CART'", [sessionId]);
    await client.query('UPDATE cart_sessions SET expires_at=NULL WHERE session_id=$1', [sessionId]);
    return { lease: null, released: rows.length > 0, expiredAt: ms(session.expired_at) };
  });
}

const fingerprint = items => createHash('sha256').update(JSON.stringify(items.map(item => [item.productId, Number(item.quantity)]).sort())).digest('hex');
function attempt(row) {
  return row ? { orderId: row.order_id, checkoutId: row.checkout_id, expiresAt: ms(row.expires_at),
    items: row.order_snapshot.items.map(item => ({ productId: item.productId, quantity: item.quantity })),
    orderSnapshot: row.order_snapshot } : null;
}
async function existingAttempt(client, sessionId, checkoutId) {
  return (await client.query(`SELECT a.* FROM checkout_attempts a JOIN cart_sessions s USING(session_id)
    WHERE a.session_id=$1 AND (a.checkout_id=$2::uuid OR a.cart_generation=s.generation)
    ORDER BY (a.checkout_id=$2::uuid) DESC LIMIT 1`, [sessionId, checkoutId])).rows[0];
}
export async function getCartCheckoutAttempt(sessionId, checkoutId, requestedItems) {
  const client = await database().pool.connect();
  try {
    const row = await existingAttempt(client, sessionId, checkoutId);
    if (row && Array.isArray(requestedItems)) {
      const combined = new Map();
      for (const item of requestedItems) combined.set(item.productId, (combined.get(item.productId) || 0) + Number(item.quantity || 1));
      if (row.request_fingerprint !== fingerprint([...combined].map(([productId, quantity]) => ({ productId, quantity })))) {
        throw fail('La selección del carrito cambió.');
      }
    }
    return attempt(row);
  }
  finally { client.release(); }
}
export async function transitionCartLeaseToOrder({ cartSessionId, checkoutId, orderId, items, availability, orderSnapshot }) {
  return inventoryTransaction(async client => {
    const session = await sessionLock(client, cartSessionId);
    const previous = await existingAttempt(client, cartSessionId, checkoutId);
    if (previous) {
      if (previous.request_fingerprint !== fingerprint(items)) throw fail('La selección del carrito cambió.');
      return attempt(previous);
    }
    const rows = await cartRows(client, cartSessionId);
    await productLocks(client, [...rows.map(row => row.product_id), ...items.map(item => item.productId)], availability);
    const timestamp = await now(client);
    if (!session.expires_at || ms(session.expires_at) <= timestamp) throw fail(EXPIRED);
    if (fingerprint(rows.map(row => ({ productId: row.product_id, quantity: row.quantity }))) !== fingerprint(items)) {
      throw fail('La selección del carrito cambió. Actualizá el carrito e intentá de nuevo.');
    }
    for (const item of items) if ((await available(client, item.productId, cartSessionId)) < item.quantity) throw fail(RESERVED);
    const expiresAt = new Date(timestamp + 45 * 60 * 1000);
    const snapshot = { ...orderSnapshot, createdAt: timestamp, updatedAt: timestamp, holdExpiresAt: ms(expiresAt) };
    const inserted = (await client.query(`INSERT INTO checkout_attempts
      (order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [orderId, cartSessionId, checkoutId, session.generation, fingerprint(items), JSON.stringify(snapshot), expiresAt])).rows[0];
    await client.query("UPDATE inventory_reservations SET phase='ORDER',order_id=$2,expires_at=$3,updated_at=clock_timestamp() WHERE session_id=$1 AND phase='CART'",
      [cartSessionId, orderId, expiresAt]);
    await client.query('UPDATE cart_sessions SET expires_at=NULL,expired_at=NULL WHERE session_id=$1', [cartSessionId]);
    await queueSellerNotification(client, { key: `order:${orderId}`, order: snapshot, type: 'ORDER_CREATED' });
    return attempt(inserted);
  });
}

export async function getOrderSnapshot(orderId) {
  return (await database().pool.query('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1', [orderId])).rows[0]?.order_snapshot || null;
}
export async function synchronizeOrderProjection(orderId, writer) {
  return inventoryTransaction(async client => {
    const row = (await client.query('SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!row) return null;
    await writer(row.order_snapshot, row.projection_version);
    await client.query('UPDATE checkout_attempts SET blob_synced_version=projection_version WHERE order_id=$1', [orderId]);
    return row.order_snapshot;
  });
}
async function orderLock(client, orderId) {
  const row = (await client.query('SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
  if (!row) return null;
  const rows = (await client.query("SELECT * FROM inventory_reservations WHERE order_id=$1 AND phase IN ('ORDER','COMMITTED') ORDER BY product_id", [orderId])).rows;
  await productLocks(client, rows.map(item => item.product_id));
  return { row, rows };
}
export async function recordOrderReceipt(orderId, receipt) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) return false;
    const { row, rows } = locked;
    const timestamp = await now(client);
    const current = withPaymentState(row.order_snapshot);
    if (current.status === 'CANCELLED' || !rows.length || current.remainingBalancePYG <= 0) return false;
    if (current.payments.some(payment => payment.verificationStatus === 'PENDING')) return false;
    if (!row.committed_at && row.expires_at && ms(row.expires_at) <= timestamp) return false;
    if (row.committed_at && current.status !== 'DEPOSIT_CONFIRMED') return false;
    const payment = { id: crypto.randomUUID(), type: row.committed_at ? 'FINAL' : 'PENDING', amountPYG: null,
      receipt, submittedAt: timestamp, submittedBy: receipt.uploadedBy || 'CUSTOMER',
      paymentMethod: 'BANK_TRANSFER', verificationStatus: 'PENDING', confirmedAt: null };
    const snapshot = { ...current, receipt: current.receipt || receipt, payments: [...current.payments, payment],
      status: row.committed_at ? 'FINAL_RECEIPT_RECEIVED' : 'RECEIPT_RECEIVED', holdExpiresAt: null, updatedAt: timestamp };
    if (!row.committed_at) await client.query("UPDATE inventory_reservations SET expires_at=NULL,updated_at=clock_timestamp() WHERE order_id=$1 AND phase='ORDER'", [orderId]);
    await client.query('UPDATE checkout_attempts SET order_snapshot=$2,expires_at=NULL,projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1',
      [orderId, JSON.stringify(snapshot)]);
    await queueSellerNotification(client, { key: `receipt:${payment.id}`, order: snapshot,
      type: row.committed_at ? 'FINAL_RECEIPT_UPLOADED' : 'RECEIPT_UPLOADED' });
    return snapshot;
  });
}
export async function confirmOrderPayment(orderId, paymentId, requestedType) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) return false;
    const { row, rows } = locked;
    const current = withPaymentState(row.order_snapshot);
    if (current.status === 'CANCELLED') return false;
    const index = current.payments.findIndex(payment => payment.id === paymentId) >= 0
      ? current.payments.findIndex(payment => payment.id === paymentId)
      : current.payments.findIndex(payment => payment.verificationStatus === 'PENDING');
    if (index < 0) {
      if (!paymentId && current.payments.length && current.payments.every(payment => payment.verificationStatus === 'CONFIRMED')) return current;
      return false;
    }
    const existing = current.payments[index];
    const inferredType = row.committed_at ? 'FINAL'
      : current.totals.futureBalancePYG > 0 ? 'DEPOSIT' : 'FULL';
    const type = String(requestedType || inferredType).toUpperCase();
    if (existing.verificationStatus === 'CONFIRMED') {
      if (existing.type !== type) throw fail('Este pago ya fue confirmado con otra clasificación.');
      return current;
    }
    const total = Number(current.totals.totalPYG || 0);
    const paid = Number(current.paidAmountPYG || 0);
    if (type === 'DEPOSIT' && (row.committed_at || paid > 0 || Number(current.totals.dueNowPYG) >= total)) {
      throw fail('Este pedido no admite una seña separada.');
    }
    if (type === 'FULL' && (row.committed_at || paid > 0)) throw fail('Este pedido ya tiene un pago confirmado.');
    if (type === 'FINAL' && (!row.committed_at || paid <= 0)) throw fail('Primero debe confirmarse la seña.');
    if (!['DEPOSIT', 'FULL', 'FINAL'].includes(type)) throw fail('Tipo de pago inválido.');
    const amount = type === 'DEPOSIT' ? Number(current.totals.dueNowPYG || 0)
      : type === 'FULL' ? total : Number(current.remainingBalancePYG || 0);
    if (amount <= 0 || paid + amount > total) throw fail('El pago supera el saldo pendiente.');
    const timestamp = await now(client);
    if (!row.committed_at) {
      const orderRows = rows.filter(item => item.phase === 'ORDER');
      if (!orderRows.length) return false;
      for (const item of orderRows) {
        await client.query('UPDATE operational_inventory SET committed_quantity=committed_quantity+$2,updated_at=clock_timestamp() WHERE product_id=$1',
          [item.product_id, item.quantity]);
      }
      await client.query("UPDATE inventory_reservations SET phase='COMMITTED',expires_at=NULL,updated_at=clock_timestamp() WHERE order_id=$1 AND phase='ORDER'", [orderId]);
    }
    const payments = current.payments.map((payment, paymentIndex) => paymentIndex === index
      ? { ...payment, type, amountPYG: amount, verificationStatus: 'CONFIRMED', confirmedAt: timestamp }
      : payment);
    const paidAmountPYG = paid + amount;
    const remainingBalancePYG = Math.max(0, total - paidAmountPYG);
    const isDelayed = current.items.some(item => item.saleMode === 'DELAYED');
    const status = remainingBalancePYG > 0 ? 'DEPOSIT_CONFIRMED'
      : isDelayed ? 'PAID_IN_FULL' : 'PAYMENT_CONFIRMED';
    const snapshot = { ...current, payments, paidAmountPYG, remainingBalancePYG, status,
      initialPaymentConfirmedAt: current.initialPaymentConfirmedAt || timestamp,
      ...(type === 'FINAL' ? { finalPaymentConfirmedAt: timestamp } : {}), updatedAt: timestamp };
    await client.query('UPDATE checkout_attempts SET committed_at=COALESCE(committed_at,$2),order_snapshot=$3,projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1',
      [orderId, new Date(timestamp), JSON.stringify(snapshot)]);
    return snapshot;
  });
}
export async function commitInventoryHold(orderId) {
  return Boolean(await confirmOrderPayment(orderId));
}
export async function cancelOrder(orderId) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) throw Object.assign(new Error('Pedido no encontrado en el inventario de pedidos.'), { status: 404 });
    const { row } = locked;
    if (row.committed_at || row.order_snapshot.initialPaymentConfirmedAt ||
        !['AWAITING_INITIAL_PAYMENT', 'RECEIPT_RECEIVED', 'VERIFYING_PAYMENT', 'CANCELLED'].includes(row.order_snapshot.status)) {
      throw fail('No se puede cancelar un pedido después de confirmar el pago.');
    }
    if (row.order_snapshot.status === 'CANCELLED') return row.order_snapshot;
    const timestamp = await now(client);
    const snapshot = { ...row.order_snapshot, status: 'CANCELLED', cancelledAt: timestamp,
      cancelledBy: 'ADMIN', inventoryReleasedAt: timestamp, holdExpiresAt: null, updatedAt: timestamp };
    await client.query("DELETE FROM inventory_reservations WHERE order_id=$1 AND phase='ORDER'", [orderId]);
    await client.query('UPDATE checkout_attempts SET order_snapshot=$2,expires_at=$3,projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1',
      [orderId, JSON.stringify(snapshot), new Date(timestamp)]);
    return snapshot;
  });
}

export async function extendCartLease(sessionId) {
  return inventoryTransaction(async client => {
    const session = await sessionLock(client, sessionId);
    const rows = await cartRows(client, sessionId);
    await productLocks(client, rows.map(row => row.product_id));
    const timestamp = await now(client);
    await expireCart(client, session, timestamp);
    if (!session.expires_at || !(await cartRows(client, sessionId)).length) throw fail(EXPIRED);
    if (session.extension_used_at) throw fail('Esta reserva ya usó su extensión de 20 minutos.');
    const maximum = ms(session.created_at) + MAX_CART_TTL;
    const extended = Math.min(ms(session.expires_at) + CART_EXTENSION, maximum);
    if (extended <= timestamp) throw fail(EXPIRED);
    session.expires_at = new Date(extended);
    session.extension_used_at = new Date(timestamp);
    await client.query('UPDATE cart_sessions SET expires_at=$2,extension_used_at=$3 WHERE session_id=$1',
      [sessionId, session.expires_at, session.extension_used_at]);
    await client.query("UPDATE inventory_reservations SET expires_at=$2,updated_at=clock_timestamp() WHERE session_id=$1 AND phase='CART'",
      [sessionId, session.expires_at]);
    return leaseStatus(client, session);
  });
}

export async function listOrderSnapshots() {
  return (await database().pool.query('SELECT order_snapshot FROM checkout_attempts ORDER BY created_at DESC')).rows.map(row => row.order_snapshot);
}

export async function readCommittedInventory() {
  const rows = (await database().pool.query(
    'SELECT product_id,capacity,committed_quantity FROM operational_inventory'
  )).rows;
  return new Map(rows.map(row => [row.product_id, row]));
}

export async function updateProductCapacity(productId, capacity) {
  return inventoryTransaction(async client => {
    await productLocks(client, [productId], { [productId]: capacity });
    await client.query('UPDATE operational_inventory SET capacity=$2,updated_at=clock_timestamp() WHERE product_id=$1', [productId, capacity]);
  });
}
