import { getDatabase } from '@netlify/database';
import { createHash } from 'node:crypto';
import {
  appendPaymentNote,
  applyPaymentConfirmation,
  confirmationRequiresInventoryCommit,
  reconcileLegacyPayment as reconcileLegacyPaymentState,
  withPaymentState,
} from './order-payments.mjs';
import { queueOrderNotifications } from './seller-notifications.mjs';

const RESERVED = 'Este artículo está temporalmente reservado por otro comprador.';
const EXPIRED = 'La reserva temporal venció y este artículo volvió a estar disponible.';
const INITIAL_CART_TTL = 35 * 60 * 1000;
const CART_EXTENSION = 20 * 60 * 1000;
const MAX_CART_TTL = 55 * 60 * 1000;
export const ORDER_HOLD_MS = 2 * 60 * 60 * 1000;
const ORDER_EXPIRING_LEAD_MS = 30 * 60 * 1000;
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

async function availableForOrderReceipt(client, productId, orderId) {
  const { rows } = await client.query(`SELECT p.capacity-p.committed_quantity-COALESCE((
    SELECT sum(r.quantity) FROM inventory_reservations r WHERE r.product_id=p.product_id
      AND r.order_id IS DISTINCT FROM $2
      AND ((r.phase='CART' AND r.expires_at>clock_timestamp())
        OR (r.phase='ORDER' AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())))
  ),0) AS available FROM operational_inventory p WHERE p.product_id=$1`, [productId, orderId]);
  return Number(rows[0]?.available || 0);
}

async function cancelOrderReservationEvents(client, orderId) {
  await client.query(`UPDATE order_reservation_events
    SET cancelled_at=clock_timestamp()
    WHERE order_id=$1 AND cancelled_at IS NULL AND processed_at IS NULL`, [orderId]);
}

async function scheduleOrderReservationEvents(client, orderId, expiresAt) {
  await cancelOrderReservationEvents(client, orderId);
  const expiration = ms(expiresAt);
  const events = [
    ['ORDER_RESERVATION_EXPIRING', new Date(expiration - ORDER_EXPIRING_LEAD_MS)],
    ['ORDER_RESERVATION_EXPIRED', new Date(expiration)],
  ];
  for (const [eventType, dueAt] of events) {
    await client.query(`INSERT INTO order_reservation_events
      (order_id,event_type,reservation_expires_at,due_at,payload)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (order_id,event_type,reservation_expires_at) DO NOTHING`, [
      orderId,
      eventType,
      expiresAt,
      dueAt,
      JSON.stringify({ orderId, reservationExpiresAt: expiration }),
    ]);
  }
}

function snapshotWithReservation(row) {
  if (!row) return null;
  const snapshot = row.order_snapshot;
  const expiresAt = ms(row.expires_at);
  const expirable = !row.committed_at &&
    ['AWAITING_INITIAL_PAYMENT', 'RESERVATION_EXPIRED'].includes(snapshot.status);
  const expired = expirable && expiresAt != null &&
    (row.reservation_expired === true || expiresAt <= Date.now());
  if (expired) {
    return {
      ...snapshot,
      status: 'RESERVATION_EXPIRED',
      reservationState: 'EXPIRED',
      holdExpiresAt: expiresAt,
    };
  }
  if (expirable && expiresAt != null) {
    return {
      ...snapshot,
      reservationState: 'ACTIVE',
      holdExpiresAt: expiresAt,
    };
  }
  return snapshot;
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
    const expiresAt = new Date(timestamp + ORDER_HOLD_MS);
    const snapshot = { ...orderSnapshot, createdAt: timestamp, updatedAt: timestamp,
      holdExpiresAt: ms(expiresAt), reservationState: 'ACTIVE' };
    const inserted = (await client.query(`INSERT INTO checkout_attempts
      (order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [orderId, cartSessionId, checkoutId, session.generation, fingerprint(items), JSON.stringify(snapshot), expiresAt])).rows[0];
    await client.query("UPDATE inventory_reservations SET phase='ORDER',order_id=$2,expires_at=$3,updated_at=clock_timestamp() WHERE session_id=$1 AND phase='CART'",
      [cartSessionId, orderId, expiresAt]);
    await scheduleOrderReservationEvents(client, orderId, expiresAt);
    await client.query('UPDATE cart_sessions SET expires_at=NULL,expired_at=NULL WHERE session_id=$1', [cartSessionId]);
    await queueOrderNotifications(client, { key: `order:${orderId}`, order: snapshot, type: 'ORDER_CREATED' });
    return attempt(inserted);
  });
}

export async function getOrderSnapshot(orderId) {
  const row = (await database().pool.query(`SELECT *,
    expires_at IS NOT NULL AND expires_at<=clock_timestamp() AS reservation_expired
    FROM checkout_attempts WHERE order_id=$1`, [orderId])).rows[0];
  return snapshotWithReservation(row);
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

async function reclaimExpiredOrderLocked(client, locked, timestamp) {
  const { row, rows } = locked;
  const current = withPaymentState(row.order_snapshot);
  const expiresAt = ms(row.expires_at);
  const canExpire = !row.committed_at &&
    ['AWAITING_INITIAL_PAYMENT', 'RESERVATION_EXPIRED'].includes(current.status);

  if (!canExpire || expiresAt == null) {
    return { order: current, renewed: false, available: true };
  }
  if (expiresAt > timestamp) {
    return { order: { ...current, reservationState: 'ACTIVE', holdExpiresAt: expiresAt },
      renewed: false, available: true };
  }

  const orderRows = rows.filter(item => item.phase === 'ORDER');
  if (!orderRows.length) {
    return { order: { ...current, status: 'RESERVATION_EXPIRED', reservationState: 'EXPIRED',
      holdExpiresAt: expiresAt }, renewed: false, available: false };
  }
  for (const item of orderRows) {
    if ((await availableForOrderReceipt(client, item.product_id, row.order_id)) < item.quantity) {
      return { order: { ...current, status: 'RESERVATION_EXPIRED', reservationState: 'EXPIRED',
        holdExpiresAt: expiresAt }, renewed: false, available: false };
    }
  }

  const renewedExpiresAt = new Date(timestamp + ORDER_HOLD_MS);
  const snapshot = {
    ...current,
    status: 'AWAITING_INITIAL_PAYMENT',
    reservationState: 'ACTIVE',
    reservationRenewedAt: timestamp,
    reservationRenewalCount: Number(current.reservationRenewalCount || 0) + 1,
    holdExpiresAt: ms(renewedExpiresAt),
    updatedAt: timestamp,
  };
  await client.query("UPDATE inventory_reservations SET expires_at=$2,updated_at=clock_timestamp() WHERE order_id=$1 AND phase='ORDER'",
    [row.order_id, renewedExpiresAt]);
  await client.query(`UPDATE checkout_attempts
    SET order_snapshot=$2,expires_at=$3,projection_version=projection_version+1,updated_at=clock_timestamp()
    WHERE order_id=$1`, [row.order_id, JSON.stringify(snapshot), renewedExpiresAt]);
  await scheduleOrderReservationEvents(client, row.order_id, renewedExpiresAt);
  row.order_snapshot = snapshot;
  row.expires_at = renewedExpiresAt;
  return { order: snapshot, renewed: true, available: true };
}

export async function refreshOrderReservation(orderId) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) return null;
    return reclaimExpiredOrderLocked(client, locked, await now(client));
  });
}

export async function recordOrderReceipt(orderId, receipt) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) return false;
    const { row, rows } = locked;
    const timestamp = await now(client);
    let current = withPaymentState(row.order_snapshot);
    if (current.status === 'CANCELLED' || !rows.length || current.remainingBalancePYG <= 0) return false;
    if (current.payments.some(payment => payment.verificationStatus === 'PENDING')) return false;
    if (!row.committed_at && row.expires_at && ms(row.expires_at) <= timestamp) {
      const reclaim = await reclaimExpiredOrderLocked(client, locked, timestamp);
      if (!reclaim.available) throw fail('La reserva venció y uno o más artículos ya no están disponibles. No realices la transferencia.');
      current = withPaymentState(reclaim.order);
    }
    if (row.committed_at && current.status !== 'DEPOSIT_CONFIRMED') return false;
    const payment = { id: crypto.randomUUID(), type: row.committed_at ? 'FINAL' : 'PENDING', amountPYG: null,
      receipt, submittedAt: timestamp, submittedBy: receipt.uploadedBy || 'CUSTOMER',
      paymentMethod: 'BANK_TRANSFER', verificationStatus: 'PENDING', confirmedAt: null };
    const snapshot = { ...current, receipt: current.receipt || receipt, payments: [...current.payments, payment],
      status: row.committed_at ? 'FINAL_RECEIPT_RECEIVED' : 'RECEIPT_RECEIVED',
      reservationState: row.committed_at ? current.reservationState : 'PROTECTED', holdExpiresAt: null, updatedAt: timestamp };
    if (!row.committed_at) await client.query("UPDATE inventory_reservations SET expires_at=NULL,updated_at=clock_timestamp() WHERE order_id=$1 AND phase='ORDER'", [orderId]);
    await cancelOrderReservationEvents(client, orderId);
    await client.query('UPDATE checkout_attempts SET order_snapshot=$2,expires_at=NULL,projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1',
      [orderId, JSON.stringify(snapshot)]);
    await queueOrderNotifications(client, { key: `receipt:${payment.id}`, order: snapshot,
      type: row.committed_at ? 'FINAL_RECEIPT_UPLOADED' : 'RECEIPT_UPLOADED' });
    return snapshot;
  });
}
export async function confirmOrderPayment(orderId, confirmation) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) return false;
    const { row, rows } = locked;
    const current = withPaymentState(row.order_snapshot);
    if (current.status === 'CANCELLED') return false;
    const type = String(confirmation?.paymentType || '').toUpperCase();
    const targetPayment = current.payments.find(payment => payment.id === confirmation?.paymentId);
    const confirmingPendingPayment = targetPayment?.verificationStatus !== 'CONFIRMED';
    if (confirmingPendingPayment && type === 'DEPOSIT' && (row.committed_at || current.confirmedPaidPYG > 0 ||
        Number(current.totals.dueNowPYG) >= Number(current.totals.totalPYG))) {
      throw fail('Este pedido no admite una seña separada.');
    }
    if (confirmingPendingPayment && type === 'FULL' && (row.committed_at || current.confirmedPaidPYG > 0)) {
      throw fail('Este pedido ya tiene un pago confirmado.');
    }
    if (confirmingPendingPayment && type === 'FINAL' && (!row.committed_at || current.confirmedPaidPYG <= 0)) {
      throw fail('Primero debe confirmarse un pago inicial.');
    }
    const timestamp = await now(client);
    const result = applyPaymentConfirmation(current, { ...confirmation, paymentType: type, timestamp });
    if (result.idempotent) return result.order;
    if (confirmationRequiresInventoryCommit(row.committed_at, result)) {
      const orderRows = rows.filter(item => item.phase === 'ORDER');
      if (!orderRows.length) return false;
      for (const item of orderRows) {
        await client.query('UPDATE operational_inventory SET committed_quantity=committed_quantity+$2,updated_at=clock_timestamp() WHERE product_id=$1',
          [item.product_id, item.quantity]);
      }
      await client.query("UPDATE inventory_reservations SET phase='COMMITTED',expires_at=NULL,updated_at=clock_timestamp() WHERE order_id=$1 AND phase='ORDER'", [orderId]);
    }
    await cancelOrderReservationEvents(client, orderId);
    const snapshot = result.order;
    await client.query('UPDATE checkout_attempts SET committed_at=COALESCE(committed_at,$2),order_snapshot=$3,projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1',
      [orderId, new Date(timestamp), JSON.stringify(snapshot)]);
    await queueOrderNotifications(client, { key: `payment:${confirmation.paymentId}`, order: snapshot,
      type: 'PAYMENT_CONFIRMED', details: { paymentType: type,
        verifiedAmountPYG: Number(confirmation.verifiedAmountPYG),
        previousConfirmedPaidPYG: result.previousConfirmedPaidPYG,
        paymentState: snapshot.paymentState } });
    return snapshot;
  });
}

export async function addOrderPaymentNote(orderId, noteInput) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) return false;
    const timestamp = await now(client);
    const snapshot = withPaymentState(appendPaymentNote(locked.row.order_snapshot,
      { ...noteInput, timestamp }), timestamp);
    await client.query(`UPDATE checkout_attempts SET order_snapshot=$2,
      projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1`,
    [orderId, JSON.stringify(snapshot)]);
    return snapshot;
  });
}

export async function reconcileOrderLegacyPayment(orderId, reconciliation) {
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, orderId);
    if (!locked) return false;
    const timestamp = await now(client);
    const snapshot = reconcileLegacyPaymentState(locked.row.order_snapshot,
      { ...reconciliation, timestamp });
    await client.query(`UPDATE checkout_attempts SET order_snapshot=$2,
      projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1`,
    [orderId, JSON.stringify(snapshot)]);
    return snapshot;
  });
}

export async function commitInventoryHold() {
  throw fail('La confirmación requiere el identificador y el importe verificado del pago.');
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
    await cancelOrderReservationEvents(client, orderId);
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
  const rows = (await database().pool.query(`SELECT *,
    expires_at IS NOT NULL AND expires_at<=clock_timestamp() AS reservation_expired
    FROM checkout_attempts ORDER BY created_at DESC`)).rows;
  return rows.map(snapshotWithReservation);
}

export async function readCommittedInventory() {
  const rows = (await database().pool.query(
    'SELECT product_id,capacity,committed_quantity FROM operational_inventory'
  )).rows;
  return new Map(rows.map(row => [row.product_id, row]));
}

export async function readPurchasableInventory() {
  const rows = (await database().pool.query(`
    SELECT inventory.product_id,inventory.capacity,inventory.committed_quantity,
      GREATEST(0,inventory.capacity-inventory.committed_quantity-COALESCE((
        SELECT sum(reservation.quantity)
        FROM inventory_reservations reservation
        WHERE reservation.product_id=inventory.product_id
          AND ((reservation.phase='CART' AND reservation.expires_at>clock_timestamp())
            OR (reservation.phase='ORDER' AND
              (reservation.expires_at IS NULL OR reservation.expires_at>clock_timestamp())))
      ),0)) AS purchasable_quantity
    FROM operational_inventory inventory
  `)).rows;
  return new Map(rows.map(row => [row.product_id, row]));
}

export async function readFulfillmentDeliveryRows() {
  return (await database().pool.query(`
    SELECT
      attempt.order_id,
      normalized.product_id,
      CASE
        WHEN jsonb_typeof(item.value->'quantity') = 'number'
          THEN (item.value->>'quantity')::numeric
        WHEN jsonb_typeof(item.value->'quantity') = 'string'
          AND btrim(item.value->>'quantity', E' \t\r\n') ~ '^[0-9]+([.][0-9]+)?$'
          THEN btrim(item.value->>'quantity', E' \t\r\n')::numeric
        ELSE NULL
      END AS quantity,
      membership.fulfillment_batch_id,
      batch.status AS batch_status,
      batch.merged_into_batch_id
    FROM checkout_attempts attempt
    CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN jsonb_typeof(attempt.order_snapshot->'items') = 'array'
        THEN attempt.order_snapshot->'items'
      ELSE '[]'::jsonb
    END) item(value)
    CROSS JOIN LATERAL (SELECT CASE
      WHEN jsonb_typeof(item.value->'productId') = 'string'
        THEN btrim(item.value->>'productId', E' \t\r\n')
      ELSE ''
    END AS product_id) normalized
    LEFT JOIN fulfillment_batch_items membership
      ON membership.order_id = attempt.order_id
      AND membership.product_id = normalized.product_id
    LEFT JOIN fulfillment_batches batch
      ON batch.fulfillment_batch_id = membership.fulfillment_batch_id
    WHERE attempt.committed_at IS NOT NULL
      AND COALESCE(attempt.order_snapshot->>'status', '') <> 'CANCELLED'
      AND normalized.product_id <> ''
    ORDER BY normalized.product_id, attempt.order_id
  `)).rows;
}

export async function updateProductCapacity(productId, capacity) {
  return inventoryTransaction(async client => {
    await productLocks(client, [productId], { [productId]: capacity });
    await client.query('UPDATE operational_inventory SET capacity=$2,updated_at=clock_timestamp() WHERE product_id=$1', [productId, capacity]);
  });
}
