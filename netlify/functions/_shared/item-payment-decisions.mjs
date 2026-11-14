import { randomUUID } from 'node:crypto';
import { database, inventoryTransaction, snapshotWithReservation } from './inventory-database.mjs';
import { orderSchedulingEligible } from './order-fulfillments.mjs';
import { activeDecisions, verifiedPayment, validPYG, itemPaymentEligibility } from './item-payment-eligibility.mjs';

const fail = message => Object.assign(new Error(message), { status: 409 });
export async function readItemPaymentDecisions(orderId, client = database().pool) {
  return (await client.query('SELECT * FROM item_payment_decisions WHERE order_id=$1 ORDER BY created_at,id', [orderId])).rows;
}
export async function requireCollectionPayments(client, items) {
  if (!items.length) throw fail('No hay artículos para entregar.');
  for (const orderId of [...new Set(items.map(i => i.orderId))].sort()) {
    const row = (await client.query('SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE',[orderId])).rows[0];
    const order = snapshotWithReservation(row);
    const decisions = await readItemPaymentDecisions(orderId,client);
    const funding = order ? itemPaymentEligibility(order,decisions) : [];
    if (!order || !orderSchedulingEligible(order) || items.filter(i=>i.orderId===orderId).some(item=>
      !funding.find(i=>i.productId===item.productId)?.handoverEligible)) {
      throw fail('Antes de entregar, confirmá y asigná el pago total de cada artículo o registrá su excepción acordada.');
    }
  }
}
export async function appendItemPaymentDecision(orderId, input, dependencies = {}) {
  return (dependencies.transaction || inventoryTransaction)(async client => {
    // Same first lock as confirmation, refunds, voids, renewal and scheduling.
    const row = (await client.query('SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!row) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
    const order = row.order_snapshot;
    const events = await readItemPaymentDecisions(orderId, client);
    const id = input.id || randomUUID();
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw fail('Identificador de decisión inválido.');
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (!note || note.length > 2000) throw fail('Ingresá una nota de auditoría de hasta 2.000 caracteres.');
    const event = { id, order_id: orderId, kind: input.kind, product_id: null, payment_id: null,
      amount_pyg: null, scheduling_required_pyg: null, collection_required_pyg: null,
      reverses_id: null, actor: 'ADMIN', note };
    if (['ALLOCATE', 'REQUIREMENT'].includes(input.kind)) {
      if (!order.items?.some(i => i.productId === input.productId)) throw fail('El artículo no pertenece al pedido.');
      event.product_id = input.productId;
    }
    if (input.kind === 'ALLOCATE') {
      const payment = order.payments?.find(p => p.id === input.paymentId);
      if (!verifiedPayment(payment, { credit: true })) throw fail('Seleccioná un pago confirmado y verificado por Admin.');
      if (!validPYG(input.amountPYG) || !input.amountPYG) throw fail('Ingresá un importe entero positivo.');
      event.payment_id = input.paymentId; event.amount_pyg = input.amountPYG;
    } else if (input.kind === 'REQUIREMENT') {
      if (!validPYG(input.schedulingRequiredPYG) || !validPYG(input.collectionRequiredPYG) ||
          input.collectionRequiredPYG < input.schedulingRequiredPYG) throw fail('Revisá los importes acordados para agendar y entregar.');
      event.scheduling_required_pyg = input.schedulingRequiredPYG;
      event.collection_required_pyg = input.collectionRequiredPYG;
    } else if (['REVERSE', 'REVOKE'].includes(input.kind)) {
      const target = events.find(e => e.id === input.reversesId);
      if (!target || target.kind !== (input.kind === 'REVERSE' ? 'ALLOCATE' : 'REQUIREMENT')) throw fail('La decisión ya fue revertida o no corresponde.');
      event.reverses_id = target.id;
    } else throw fail('Tipo de decisión inválido.');
    const duplicate = events.find(e => e.id === id);
    if (duplicate) {
      if (Object.keys(event).every(k => String(event[k]) === String(duplicate[k]))) return duplicate;
      throw fail('El identificador ya corresponde a otra decisión.');
    }
    if (event.reverses_id && events.some(e => e.reverses_id === event.reverses_id)) throw fail('La decisión ya fue revertida.');
    if (input.kind === 'REQUIREMENT' && activeDecisions(events).some(e => e.kind === 'REQUIREMENT' && e.product_id === input.productId)) {
      throw fail('Revocá la excepción anterior antes de aprobar otra.');
    }
    if (input.kind === 'ALLOCATE' && itemPaymentEligibility(order, [...events, event]).find(i => i.productId === input.productId)?.reviewRequired) {
      throw fail('El importe excede los fondos disponibles o el historial requiere revisión.');
    }
    return (await client.query(`INSERT INTO item_payment_decisions
      (id,order_id,kind,product_id,payment_id,amount_pyg,scheduling_required_pyg,collection_required_pyg,reverses_id,actor,note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, Object.values(event))).rows[0];
  });
}
