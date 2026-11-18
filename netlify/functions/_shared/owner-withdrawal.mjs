import { inventoryTransaction } from './inventory-database.mjs';

const conflict = (message, commitments = []) => Object.assign(new Error(message), { status: 409, commitments });

// The inventory row is also checkout's product lock. No Blob write, fictional
// sale, capacity reduction or inventory counter conversion is needed.
export async function withdrawFromSale(product, { confirmed, actor = 'OWNER' } = {}) {
  if (actor !== 'OWNER') throw Object.assign(new Error('Acción exclusiva del propietario.'), { status: 403 });
  if (confirmed !== true) throw conflict('Confirmá que querés retirar este artículo de la venta.');
  if (!product?.id) throw Object.assign(new Error('Artículo no encontrado.'), { status: 404 });
  return inventoryTransaction(async client => {
    const capacity = Number(product.quantityRemaining ?? product.quantityTotal ?? 1);
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw conflict('La cantidad requiere revisión.');
    await client.query('INSERT INTO operational_inventory(product_id,capacity) VALUES($1,$2) ON CONFLICT DO NOTHING', [product.id, capacity]);
    const stock = (await client.query('SELECT * FROM operational_inventory WHERE product_id=$1 FOR UPDATE', [product.id])).rows[0];
    if (!Object.hasOwn(stock, 'owner_withdrawal')) throw Object.assign(new Error('La actualización de inventario requiere aprobación y preparación antes de usar esta acción.'), { status: 503 });
    if (stock.owner_withdrawal) return stock.owner_withdrawal;
    const holds = (await client.query(`SELECT phase,order_id,quantity,expires_at FROM inventory_reservations
      WHERE product_id=$1 AND (phase='COMMITTED' OR
        (phase='CART' AND expires_at>clock_timestamp()) OR
        (phase='ORDER' AND (expires_at IS NULL OR expires_at>clock_timestamp()))) ORDER BY reservation_id`, [product.id])).rows;
    // Include commitments with missing/inconsistent reservation evidence. Do not
    // lock orders after products: ordinary payment paths lock orders first.
    const orders = (await client.query(`SELECT order_id,order_snapshot->>'status' AS status FROM checkout_attempts
      WHERE COALESCE(order_snapshot->>'status','') <> 'CANCELLED'
      AND (committed_at IS NOT NULL OR expires_at IS NULL OR expires_at>clock_timestamp()
        OR jsonb_array_length(COALESCE(order_snapshot->'payments','[]'::jsonb))>0)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(order_snapshot->'items')='array'
        THEN order_snapshot->'items' ELSE '[]'::jsonb END) item WHERE item->>'productId'=$1)
      ORDER BY order_id`, [product.id])).rows;
    const fulfillment = (await client.query(`SELECT order_id,fulfillment_batch_id FROM fulfillment_batch_items
      WHERE product_id=$1 ORDER BY order_id`, [product.id])).rows;
    const commitments = [...holds, ...orders, ...fulfillment];
    if (Number(stock.committed_quantity) > 0 || commitments.length) {
      const ids = [...new Set(commitments.map(c => c.order_id).filter(Boolean))];
      throw conflict(`No se retiró el artículo: tiene ${ids.length ? `compromisos en ${ids.join(', ')}` : 'una reserva activa o inventario comprometido'}. Revisalos antes de continuar.`, commitments);
    }
    if (product.status !== 'AVAILABLE' || capacity <= 0) throw conflict('Este artículo no está disponible para retirar de la venta. Requiere revisión.');
    const at = (await client.query('SELECT clock_timestamp() AS at')).rows[0].at;
    const evidence = { action: 'OWNER_WITHDRAWAL', actor: 'OWNER', productId: product.id,
      recordedAt: new Date(at).toISOString(), reason: 'Retenido por el propietario. Sin venta ni movimiento de dinero.',
      product: structuredClone(product) };
    await client.query('UPDATE operational_inventory SET owner_withdrawal=$2,updated_at=clock_timestamp() WHERE product_id=$1', [product.id, JSON.stringify(evidence)]);
    return evidence;
  });
}

export function applyOwnerWithdrawal(product, inventory) {
  if (!inventory?.owner_withdrawal) return product;
  return { ...product, status: 'UNLISTED', ownerWithdrawal: {
    action: inventory.owner_withdrawal.action, actor: inventory.owner_withdrawal.actor,
    recordedAt: inventory.owner_withdrawal.recordedAt,
  } };
}
