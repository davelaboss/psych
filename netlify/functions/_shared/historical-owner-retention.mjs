import {createHash} from 'node:crypto';
import {inventoryTransaction} from './inventory-database.mjs';
import {FULFILLMENT_LOCK} from './fulfillment-batches-core.mjs';
import {RETENTION_ORDER,RETENTION_BATCH,RETENTION_CORRECTION,RETENTION_KIND,RETENTION_ITEMS,RETENTION_SIBLING_ORDER,CLOSED_OWNER_RETENTION,isOwnerRetainedOrder} from './owner-retention-core.mjs';

const fail=message=>Object.assign(new Error(message),{status:409});
const canonical=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))):v;
const fingerprint=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const ids=RETENTION_ITEMS.map(i=>i.productId);

// A single SQL snapshot, also usable with the production READ ONLY role.
export async function readOwnerRetentionPlan(client){
 const row=(await client.query(`SELECT clock_timestamp() at,jsonb_build_object(
  'order',(SELECT to_jsonb(a) FROM checkout_attempts a WHERE order_id=$1),
  'inventory',(SELECT jsonb_agg(jsonb_build_object('productId',product_id,'capacity',capacity,'committed',committed_quantity,
    'withdrawal',to_jsonb(p)->'owner_withdrawal') ORDER BY product_id) FROM operational_inventory p WHERE product_id=ANY($3::text[])),
  'reservations',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY reservation_id),'[]'::jsonb) FROM inventory_reservations r WHERE product_id=ANY($3::text[])),
  'batch',(SELECT to_jsonb(b) FROM fulfillment_batches b WHERE fulfillment_batch_id=$2::uuid),
  'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY order_id,product_id) FROM fulfillment_batch_items m WHERE fulfillment_batch_id=$2::uuid),
  'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY event_id),'[]'::jsonb) FROM fulfillment_batch_events e WHERE fulfillment_batch_id=$2::uuid),
  'appointments',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY timing_key),'[]'::jsonb) FROM pickup_appointments a WHERE order_id=$1),
  'decisions',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM item_payment_decisions d WHERE order_id=$1),
  'otherOrders',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY order_id),'[]'::jsonb) FROM checkout_attempts a WHERE order_id<>$1
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.order_snapshot->'items') i WHERE i->>'productId'=ANY($3::text[]))),
  'control',(SELECT to_jsonb(c) FROM pickup_write_control c)
 ) state`,[RETENTION_ORDER,RETENTION_BATCH,ids])).rows[0];
 return {capturedAt:new Date(row.at).toISOString(),state:row.state,fingerprint:fingerprint(row.state)};
}

export function validateOwnerRetentionPlan(plan){
 const s=plan.state,o=s.order?.order_snapshot,b=s.batch;
 if(!o||o.id!==RETENTION_ORDER||!s.order.committed_at||o.status!=='PAYMENT_CONFIRMED')throw fail('El pedido histórico cambió.');
 if(isOwnerRetainedOrder(o))return {alreadyApplied:true};
 const lines=(o.items||[]).map(i=>({productId:i.productId,itemNumber:i.itemNumber,quantity:i.quantity})).sort((a,b)=>a.productId.localeCompare(b.productId));
 if(JSON.stringify(lines)!==JSON.stringify([...RETENTION_ITEMS].sort((a,b)=>a.productId.localeCompare(b.productId))))throw fail('Los cuatro artículos o sus cantidades cambiaron.');
 const agreed={43:9000,411:28000,432:30000,466:28000};
 if(!o.items.every(i=>i.saleMode==='IMMEDIATE'&&i.unitPricePYG===agreed[i.itemNumber]&&i.dueNowPYG===agreed[i.itemNumber]&&i.futureBalancePYG===0))throw fail('Los términos originales de los artículos cambiaron.');
 const p=o.payments,a=o.paymentAdjustments;
 if(o.totals?.totalPYG!==95000||o.totals.dueNowPYG!==95000||o.totals.futureBalancePYG!==0||p?.length!==1||
  p[0].id!=='c5929d87-e991-41bb-a468-2ddca8605c6d'||p[0].amountPYG!==95000||p[0].amountSource!=='ADMIN_VERIFIED'||
  p[0].verificationStatus!=='CONFIRMED'||p[0].verifiedBy!=='ADMIN'||p[0].voidedAt!=null||a?.length!==1||
  a[0].id!=='375c0bab-e233-45c2-ad12-2ecb8db53a55'||a[0].kind!=='POST_SALE_PRICE_ADJUSTMENT'||a[0].amountPYG!==95000)throw fail('La evidencia financiera histórica cambió.');
 if(!b||b.fulfillment_batch_id!==RETENTION_BATCH||b.status!=='PREPARED'||Number(b.revision)!==2||b.auto_attach||b.delivered_at||b.merged_into_batch_id)throw fail('La planilla preparada cambió.');
 if(s.memberships?.length!==4||!ids.every(id=>s.memberships.some(m=>m.order_id===RETENTION_ORDER&&m.product_id===id)))throw fail('La membresía de la planilla cambió.');
 if(s.events.length!==1||Number(s.events[0].event_id)!==204||s.events[0].event_type!=='PREPARE'||
    s.events[0].affected_items?.length!==4||!ids.every(id=>s.events[0].affected_items.some(i=>i.orderId===RETENTION_ORDER&&i.productId===id))||
    s.appointments.length||s.decisions.length)throw fail('Los compromisos o la auditoría del pedido requieren revisión.');
 const reservations=s.reservations.filter(r=>r.order_id===RETENTION_ORDER);
 if(reservations.length!==4||!ids.every(id=>reservations.some(r=>r.product_id===id&&r.phase==='COMMITTED'&&Number(r.quantity)===1)))throw fail('Las cuatro reservas comprometidas cambiaron.');
 if(s.inventory?.length!==4||!s.inventory.every(p=>p.capacity===(p.productId===ids[3]?3:1)&&p.committed===(p.productId===ids[3]?2:1)&&!p.withdrawal))throw fail('El inventario comprometido cambió.');
 const siblings=s.reservations.filter(r=>r.phase==='COMMITTED'&&r.order_id!==RETENTION_ORDER);
 if(siblings.length!==1||siblings[0].product_id!==ids[3]||siblings[0].order_id!==RETENTION_SIBLING_ORDER||Number(siblings[0].quantity)!==1)throw fail('El compromiso del otro cliente cambió.');
 const now=Date.parse(plan.capturedAt);
 if(s.reservations.some(r=>r.phase!=='COMMITTED'&&(r.expires_at==null||Date.parse(r.expires_at)>now)))throw fail('Hay otra reserva activa; no se modifica.');
 if(s.otherOrders.some(r=>r.committed_at&&r.order_id!==RETENTION_SIBLING_ORDER)||!s.otherOrders.some(r=>r.order_id===RETENTION_SIBLING_ORDER&&r.committed_at))throw fail('Los pedidos relacionados requieren revisión.');
 if(s.control?.paused!==false)throw fail('El control operativo cambió; no se modifica.');
 return {alreadyApplied:false};
}

// No HTTP endpoint calls this. Execution needs a separately approved exact plan.
export async function applyHistoricalOwnerRetention({expectedFingerprint,approvalReference,actor='OWNER'},dependencies={}){
 if(actor!=='OWNER')throw Object.assign(new Error('Acción exclusiva del propietario.'),{status:403});
 if(!/^[a-f0-9]{64}$/.test(expectedFingerprint||'')||typeof approvalReference!=='string'||!approvalReference.trim()||approvalReference.length>1000)throw fail('Faltan la aprobación separada y la huella del plan exacto.');
 return (dependencies.transaction||inventoryTransaction)(async client=>{
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('SELECT pg_advisory_xact_lock($1)',[FULFILLMENT_LOCK]);
  await client.query('SELECT fulfillment_batch_id FROM fulfillment_batches WHERE fulfillment_batch_id=$1 FOR UPDATE',[RETENTION_BATCH]);
  await client.query('SELECT order_id FROM checkout_attempts WHERE order_id=ANY($1::text[]) ORDER BY order_id FOR UPDATE',[[RETENTION_ORDER,RETENTION_SIBLING_ORDER]]);
  await client.query('SELECT product_id FROM operational_inventory WHERE product_id=ANY($1::text[]) ORDER BY product_id FOR UPDATE',[ids]);
  const plan=await readOwnerRetentionPlan(client),validated=validateOwnerRetentionPlan(plan);
  const previous=plan.state.order.order_snapshot.ownerRetention;
  if(validated.alreadyApplied){
   if(previous.plannedFingerprint!==expectedFingerprint||previous.approvalReference!==approvalReference||plan.state.batch.status!==CLOSED_OWNER_RETENTION)throw fail('La corrección previa no coincide con esta aprobación.');
   return {alreadyApplied:true,correction:previous};
  }
  if(plan.fingerprint!==expectedFingerprint)throw fail('El estado cambió desde la aprobación. No se aplicó la corrección.');
  const correction={kind:RETENTION_KIND,correctionId:RETENTION_CORRECTION,actor:'OWNER',retainedBy:['David','María'],
    items:RETENTION_ITEMS,recordedAt:plan.capturedAt,approvalReference,plannedFingerprint:expectedFingerprint,
    actualCashReceivedPYG:0,actualCashRefundedPYG:0,
    statement:'Las cuatro unidades fueron retenidas por David y María. No hubo intercambio real de dinero, venta a cliente ni entrega.',
    originalPaymentId:'c5929d87-e991-41bb-a468-2ddca8605c6d',originalAdjustmentId:'375c0bab-e233-45c2-ad12-2ecb8db53a55',originalPreparationEventId:204};
  const original=plan.state.order.order_snapshot;
  await client.query(`UPDATE checkout_attempts SET order_snapshot=$2,projection_version=projection_version+1,updated_at=clock_timestamp() WHERE order_id=$1`,[RETENTION_ORDER,JSON.stringify({...original,ownerRetention:correction})]);
  await client.query(`UPDATE fulfillment_batches SET status=$2,revision=revision+1,auto_attach=false,updated_at=clock_timestamp() WHERE fulfillment_batch_id=$1`,[RETENTION_BATCH,CLOSED_OWNER_RETENTION]);
  await client.query(`INSERT INTO fulfillment_batch_events(event_type,fulfillment_batch_id,target_batch_id,actor,affected_items,revisions,context)
    VALUES('OWNER_RETENTION',$1,$1,'OWNER',$2,$3,$4)`,[RETENTION_BATCH,JSON.stringify(RETENTION_ITEMS.map(i=>({orderId:RETENTION_ORDER,productId:i.productId}))),JSON.stringify({before:2,after:3}),JSON.stringify(correction)]);
  return {alreadyApplied:false,correction};
 });
}
