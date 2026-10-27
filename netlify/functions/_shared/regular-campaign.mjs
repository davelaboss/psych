import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { PREPARATION_EVIDENCE } from './regular-campaign-seed.mjs';

export const REGULAR_CAMPAIGN = 'regular-chatgpt-daily-v1';
export const LEDGER_KEY = 'history-v1.json';
export const BASELINE_KEY = 'baseline-v1.json';
const people = ['David', 'Maria'];
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const dateInParaguay = now => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(now));

function campaignStore() {
  // Separate marketing files in the existing storage service; never product/order stores.
  return getStore({ name: 'mudanza-regular-chatgpt-marketing', consistency: 'strong' });
}

export function validateCampaignHistory(history) {
  if (!history || history.schemaVersion !== 1 || history.campaignId !== REGULAR_CAMPAIGN ||
      !validId(history.cycleId) || !validDate(history.startedAt) ||
      history.historicalCompleteness !== 'UNRECONCILED' ||
      !Number.isSafeInteger(history.revision) || history.revision < 1 ||
      !Array.isArray(history.preparationEvidence) || !Array.isArray(history.batches)) {
    throw fail('Historial de campaña no fiable. No se preparó una selección.');
  }
  for (const evidence of history.preparationEvidence) {
    if (!validId(evidence.productId) || !Number.isSafeInteger(evidence.itemNumber) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(evidence.preparedDate) || typeof evidence.source !== 'string') {
      throw fail('Evidencia de preparación no válida.');
    }
  }
  const batchIds = new Set();
  for (const batch of history.batches) {
    const ids = new Set(), numbers = new Set();
    if (!validId(batch.id) || batchIds.has(batch.id) || batch.campaignId !== REGULAR_CAMPAIGN ||
        batch.cycleId !== history.cycleId || !validDate(batch.preparedAt) || Date.parse(batch.preparedAt) < Date.parse(history.startedAt) ||
        !['FIRST_PASS', 'PHASE_2'].includes(batch.phase) ||
        batch.date !== dateInParaguay(batch.preparedAt) || !batch.assignments ||
        Object.keys(batch.assignments).sort().join(',') !== 'David,Maria') {
      throw fail('Lote de campaña no fiable.');
    }
    batchIds.add(batch.id);
    for (const person of people) {
      if (!Array.isArray(batch.assignments[person]) || batch.assignments[person].length > 5) throw fail('Asignación no válida.');
      for (const item of batch.assignments[person]) {
        if (!validId(item.productId) || ids.has(item.productId) || numbers.has(item.itemNumber) || !Number.isSafeInteger(item.itemNumber) ||
            item.itemNumber < 1 || !(item.postedAt === null ||
              (validDate(item.postedAt) && Date.parse(item.postedAt) >= Date.parse(batch.preparedAt) && item.confirmedBy === 'SELLER_ADMIN'))) {
          throw fail('Confirmación de campaña no fiable.');
        }
        ids.add(item.productId); numbers.add(item.itemNumber);
      }
    }
    if (!ids.size) throw fail('Lote vacío no válido.');
  }
  return history;
}

function coverage(history) {
  const posted = new Set(), prepared = new Map();
  const recordPreparation = (id, date) => {
    if (!prepared.has(id) || date > prepared.get(id)) prepared.set(id, date);
  };
  for (const evidence of history.preparationEvidence) {
    recordPreparation(evidence.productId, evidence.preparedDate);
  }
  for (const batch of history.batches) for (const person of people) {
    for (const item of batch.assignments[person]) {
      recordPreparation(item.productId, batch.preparedAt);
      if (item.postedAt) posted.add(item.productId);
    }
  }
  return { posted, prepared };
}

function eligibleProducts(packet) {
  if (!packet?.generatedAt || !Array.isArray(packet.marketableProducts)) throw fail('Faltan datos Sale Pulse actuales.');
  const ids = new Set(), numbers = new Set();
  return packet.marketableProducts.filter(p => p?.marketabilityStatus === 'MARKETABLE').map(p => {
    let urlsValid = false;
    try { urlsValid = [p.productUrl, p.mainImage].every(url => typeof url === 'string' && url.length > 0 &&
      new URL(url, 'https://thelabossieres.com').protocol === 'https:'); } catch { /* fail below */ }
    if (!validId(p.productId) || ids.has(p.productId) || numbers.has(p.itemNumber) ||
        !Number.isSafeInteger(p.itemNumber) || p.itemNumber < 1 || !p.title || !p.category || !p.saleMode ||
        !Number.isFinite(p.askingPricePYG) || p.askingPricePYG <= 0 || !(p.purchasableQuantity > 0) || !urlsValid) {
      throw fail('Faltan datos completos para preparar la campaña.');
    }
    ids.add(p.productId); numbers.add(p.itemNumber);
    return p;
  });
}

export function selectRegularCampaign(packet, history, now) {
  validateCampaignHistory(history);
  const products = eligibleProducts(packet);
  const { posted, prepared } = coverage(history);
  const firstPass = products.filter(p => !posted.has(p.productId));
  const phase = firstPass.length ? 'FIRST_PASS' : 'PHASE_2';
  const today = dateInParaguay(now);
  const byIdentity = (a, b) => a.itemNumber - b.itemNumber || a.productId.localeCompare(b.productId);
  const todayIds = new Set(history.batches.filter(b => b.date === today)
    .flatMap(b => people.flatMap(person => b.assignments[person].map(p => p.productId))));
  const ranked = phase === 'FIRST_PASS'
    ? firstPass.sort((a, b) => Number(prepared.has(a.productId)) - Number(prepared.has(b.productId)) ||
      String(prepared.get(a.productId) || '').localeCompare(String(prepared.get(b.productId) || '')) || byIdentity(a, b))
    : products.filter(p => !todayIds.has(p.productId)).sort((a, b) => b.askingPricePYG - a.askingPricePYG || byIdentity(a, b));
  return { phase, products: ranked.slice(0, 10), eligibleUnconfirmedCount: firstPass.length, totalMarketable: products.length };
}

export function campaignPanel(history) {
  validateCampaignHistory(history);
  const { posted } = coverage(history);
  return {
    status: 'READY', campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId,
    startedAt: history.startedAt, historicalCompleteness: history.historicalCompleteness, revision: history.revision,
    pendingBatches: history.batches.map(batch => ({
      id: batch.id, date: batch.date, phase: batch.phase,
      assignments: Object.fromEntries(people.map(person => [person, batch.assignments[person]
        .filter(p => !p.postedAt && (batch.phase === 'PHASE_2' || !posted.has(p.productId)))
        .map(p => ({ productId: p.productId, itemNumber: p.itemNumber }))])),
    })).filter(batch => people.some(person => batch.assignments[person].length)),
  };
}

async function readHistory(store) {
  const row = await store.getWithMetadata(LEDGER_KEY, { type: 'json', consistency: 'strong' });
  if (row) {
    if (!row.etag) throw fail('No se puede verificar la versión del historial.');
    validateCampaignHistory(row.data);
  }
  const baseline = await store.get(BASELINE_KEY, { type: 'json', consistency: 'strong' });
  if (row && (!baseline || baseline.campaignId !== REGULAR_CAMPAIGN ||
      baseline.cycleId !== row.data.cycleId || baseline.startedAt !== row.data.startedAt)) {
    throw fail('La base del ciclo no coincide con el historial.');
  }
  if (!row && baseline) throw fail('Falta el historial del ciclo activo; restaurá su copia antes de continuar.');
  return row;
}

export async function readCampaignPanel({ store = campaignStore() } = {}) {
  const row = await readHistory(store);
  return row ? campaignPanel(row.data) : { status: 'UNINITIALIZED', campaignId: REGULAR_CAMPAIGN };
}

function handoffCampaign(packet, history, batch) {
  const selection = selectRegularCampaign(packet, history, batch.preparedAt);
  const marketable = new Set(eligibleProducts(packet).map(p => p.productId));
  const { posted } = coverage(history);
  const assignments = Object.fromEntries(people.map(person => [person, batch.assignments[person]
    .filter(p => marketable.has(p.productId) && !p.postedAt && (batch.phase === 'PHASE_2' || !posted.has(p.productId)))
    .map(p => p.productId)]));
  return {
    ...packet,
    regularCampaign: {
      ...campaignPanel(history), pendingBatches: undefined, batchId: batch.id, phase: batch.phase,
      eligibleUnconfirmedCount: selection.eligibleUnconfirmedCount, totalMarketable: selection.totalMarketable,
      assignments, selectedProductIds: people.flatMap(person => assignments[person]),
    },
  };
}

export async function updateRegularCampaign({ body, loadPacket, store = campaignStore(),
  now = () => new Date().toISOString(), idFactory = randomUUID, evidence = PREPARATION_EVIDENCE }) {
  if (!body || body.campaignId !== REGULAR_CAMPAIGN || !['prepare', 'confirm'].includes(body.action) ||
      Object.keys(body).some(key => !['action', 'campaignId', 'cycleId', 'batchId', 'person', 'productIds', 'confirmation'].includes(key))) {
    throw fail('Acción exclusiva de la campaña regular no válida.', 400);
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const instant = now();
    if (!validDate(instant)) throw fail('Fecha de campaña no válida.');
    const row = await readHistory(store);
    let history = row ? structuredClone(row.data) : null;
    if (!history) {
      if (body.action !== 'prepare') throw fail('No existe un ciclo activo.');
      history = { schemaVersion: 1, campaignId: REGULAR_CAMPAIGN, cycleId: idFactory(),
        startedAt: instant, historicalCompleteness: 'UNRECONCILED', revision: 1,
        preparationEvidence: structuredClone(evidence), batches: [] };
    }
    let batch, packet, changed = false;
    if (body.action === 'prepare') {
      if (Object.keys(body).length !== 2) throw fail('La selección se calcula en el servidor.', 400);
      packet = await loadPacket();
      const selected = selectRegularCampaign(packet, history, instant);
      // Reopening today's incomplete handoff is a retry, not a new preparation.
      batch = history.batches.findLast(b => b.date === dateInParaguay(instant) && b.phase === selected.phase &&
        handoffCampaign(packet, history, b).regularCampaign.selectedProductIds.length);
      if (!batch) {
        if (!selected.products.length) throw fail('No hay Items disponibles para otra selección hoy.');
        batch = { id: idFactory(), campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId,
          date: dateInParaguay(instant), preparedAt: instant, phase: selected.phase,
          assignments: Object.fromEntries(people.map((person, index) => [person, selected.products
            .slice(index * 5, index * 5 + 5).map(p => ({ productId: p.productId, itemNumber: p.itemNumber, postedAt: null }))])) };
        history.batches.push(batch); changed = true;
      }
    } else {
      if (body.cycleId !== history.cycleId || !people.includes(body.person) ||
          body.confirmation !== 'PUBLISHED_REGULAR_CAMPAIGN' || !Array.isArray(body.productIds) ||
          !body.productIds.length || body.productIds.length > 5 || new Set(body.productIds).size !== body.productIds.length) {
        throw fail('Confirmá únicamente los Items realmente publicados de este lote regular.', 400);
      }
      batch = history.batches.find(b => b.id === body.batchId);
      if (!batch || body.productIds.some(id => !batch.assignments[body.person].some(p => p.productId === id))) {
        throw fail('Los Items no pertenecen a la persona y lote indicados.', 400);
      }
      for (const item of batch.assignments[body.person]) if (body.productIds.includes(item.productId) && !item.postedAt) {
        item.postedAt = instant; item.confirmedBy = 'SELLER_ADMIN'; changed = true;
      }
    }
    if (changed) {
      if (row) history.revision++;
      validateCampaignHistory(history);
      if (!row) {
        const baseline = { campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId, startedAt: history.startedAt,
          historicalCompleteness: 'UNRECONCILED' };
        const created = await store.setJSON(BASELINE_KEY, baseline, { onlyIfNew: true });
        if (!created.modified) continue;
      }
      const saved = await store.setJSON(LEDGER_KEY, history, row ? { onlyIfMatch: row.etag } : { onlyIfNew: true });
      if (!saved.modified) continue;
    }
    return { campaign: campaignPanel(history), packet: packet ? handoffCampaign(packet, history, batch) : undefined };
  }
  throw fail('El historial cambió en otra sesión. Volvé a intentar con datos actuales.');
}
