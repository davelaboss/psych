import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getStore } from '@netlify/blobs';
import { PREPARATION_EVIDENCE } from './regular-campaign-seed.mjs';

export const REGULAR_CAMPAIGN = 'regular-chatgpt-daily-v1';
export const PRIORITY_PASS = 'priority-over-50000-v1';
export const LEDGER_KEY = 'history-v1.json';
export const BASELINE_KEY = 'baseline-v1.json';
const people = ['David', 'Maria'];
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const validEtag = value => typeof value === 'string' && value !== '*' && !/^W\//i.test(value) &&
  /^(?:"[^"\s\x00-\x1f\x7f]+"|[^"\s\x00-\x1f\x7f]+)$/.test(value);
const uncertainWrite = () => fail('No se pudo verificar la escritura del historial. Reintentá con datos actuales.', 503);
const dateInParaguay = now => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(now));

function campaignStore() {
  // Separate marketing files in the existing storage service; never product/order stores.
  return getStore({ name: 'mudanza-regular-chatgpt-marketing', consistency: 'strong' });
}

function includesHistoryWrite(actual, expected) {
  const { revision, batches, initialization, ...fixed } = expected;
  const { revision: currentRevision, batches: currentBatches, initialization: currentInitialization, ...currentFixed } = actual;
  if (currentRevision < revision || !isDeepStrictEqual(currentFixed, fixed) ||
      !(initialization === 'PROVISIONAL' ? ['PROVISIONAL', 'ESTABLISHED'] :
        initialization === 'ESTABLISHED' ? ['ESTABLISHED'] : [undefined, 'ESTABLISHED']).includes(currentInitialization)) return false;
  const immutableBatch = batch => ({ ...batch, assignments: Object.fromEntries(people.map(person =>
    [person, batch.assignments[person].map(({ postedAt, confirmedBy, ...item }) => item)])) });
  return batches.every(batch => {
    const current = currentBatches.find(candidate => candidate.id === batch.id);
    return current && isDeepStrictEqual(immutableBatch(current), immutableBatch(batch)) && people.every(person =>
      batch.assignments[person].every((item, index) => item.postedAt === null ||
        (current.assignments[person][index].postedAt === item.postedAt &&
          current.assignments[person][index].confirmedBy === item.confirmedBy)));
  });
}

async function writeCampaignFile(store, key, data, conditions) {
  const result = await store.setJSON(key, data, conditions);
  // The locked SDK reports non-412 provider failures as modified:true with an empty ETag.
  // Only a real 412 result is a retryable CAS conflict; uncertain writes fail safely.
  if (result?.modified === false) return result;
  if (result?.modified !== true || !validEtag(result.etag)) throw uncertainWrite();
  const readback = key === LEDGER_KEY
    ? await readHistory(store)
    : await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
  if (!readback || !validEtag(readback.etag) || !(key === LEDGER_KEY
    ? includesHistoryWrite(readback.data, data)
    : isDeepStrictEqual(readback.data, data))) throw uncertainWrite();
  // The read ETag may be newer than the write ETag after a legitimate concurrent update.
  return { ...result, readback: readback.data };
}

export function validateCampaignHistory(history, { allowProvisional = false } = {}) {
  if (!history || history.schemaVersion !== 1 || history.campaignId !== REGULAR_CAMPAIGN ||
      !validId(history.cycleId) || !validDate(history.startedAt) ||
      history.historicalCompleteness !== 'UNRECONCILED' ||
      !Number.isSafeInteger(history.revision) || history.revision < 1 ||
      !Array.isArray(history.preparationEvidence) || !Array.isArray(history.batches) ||
      ![undefined, 'PROVISIONAL', 'ESTABLISHED'].includes(history.initialization) ||
      (history.initialization === 'PROVISIONAL' && (!allowProvisional || history.revision !== 1 ||
        history.batches.length !== 1))) {
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
        ![undefined, PRIORITY_PASS].includes(batch.passId) || (batch.passId === PRIORITY_PASS && batch.phase !== 'FIRST_PASS') ||
        batch.date !== dateInParaguay(batch.preparedAt) || !batch.assignments ||
        Object.keys(batch.assignments).sort().join(',') !== 'David,Maria') {
      throw fail('Lote de campaña no fiable.');
    }
    batchIds.add(batch.id);
    for (const person of people) {
      if (!Array.isArray(batch.assignments[person]) || batch.assignments[person].length > 5) throw fail('Asignación no válida.');
      for (const item of batch.assignments[person]) {
        if (!validId(item.productId) || ids.has(item.productId) || numbers.has(item.itemNumber) || !Number.isSafeInteger(item.itemNumber) ||
            item.itemNumber < 1 || (history.initialization === 'PROVISIONAL' && item.postedAt !== null) || !(item.postedAt === null ||
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
  // Untagged broad-campaign records remain immutable history, outside this pass.
  for (const batch of history.batches.filter(b => b.passId === PRIORITY_PASS)) for (const person of people) {
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
  return packet.marketableProducts.filter(p => p?.marketabilityStatus === 'MARKETABLE' &&
    p.askingPricePYG > 50000 && p.purchasableQuantity > 0).map(p => {
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
  const byIdentity = (a, b) => a.itemNumber - b.itemNumber || a.productId.localeCompare(b.productId);
  const ranked = firstPass.sort((a, b) => Number(prepared.has(a.productId)) - Number(prepared.has(b.productId)) ||
    String(prepared.get(a.productId) || '').localeCompare(String(prepared.get(b.productId) || '')) || byIdentity(a, b));
  return { phase: 'FIRST_PASS', products: ranked.slice(0, 10), eligibleUnconfirmedCount: firstPass.length, totalMarketable: products.length };
}

export function campaignPanel(history) {
  validateCampaignHistory(history);
  const { posted } = coverage(history);
  return {
    status: 'READY', campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId,
    passId: PRIORITY_PASS, passStartedAt: history.batches.find(b => b.passId === PRIORITY_PASS)?.preparedAt || null,
    startedAt: history.startedAt, historicalCompleteness: history.historicalCompleteness, revision: history.revision,
    pendingBatches: history.batches.filter(b => b.passId === PRIORITY_PASS).map(batch => ({
      id: batch.id, date: batch.date, phase: batch.phase,
      assignments: Object.fromEntries(people.map(person => [person, batch.assignments[person]
        .filter(p => !p.postedAt && (batch.phase === 'PHASE_2' || !posted.has(p.productId)))
        .map(p => ({ productId: p.productId, itemNumber: p.itemNumber }))])),
    })).filter(batch => people.some(person => batch.assignments[person].length)),
  };
}

async function readHistory(store) {
  const readRow = () => store.getWithMetadata(LEDGER_KEY, { type: 'json', consistency: 'strong' });
  let row = await readRow();
  const baseline = await store.get(BASELINE_KEY, { type: 'json', consistency: 'strong' });
  // Another initializer may have created both files between these strong reads.
  if (!row && baseline) row = await readRow();
  if (row) {
    if (!validEtag(row.etag)) throw fail('No se puede verificar la versión del historial.');
    validateCampaignHistory(row.data, { allowProvisional: true });
  }
  if (row && ((!baseline && row.data.initialization !== 'PROVISIONAL') ||
      (baseline && (baseline.campaignId !== REGULAR_CAMPAIGN ||
        baseline.cycleId !== row.data.cycleId || baseline.startedAt !== row.data.startedAt)))) {
    throw fail('La base del ciclo no coincide con el historial.');
  }
  if (!row && baseline) throw fail('Falta el historial del ciclo activo; restaurá su copia antes de continuar.');
  return row;
}

async function finishInitialization(store, history) {
  const baseline = { campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId, startedAt: history.startedAt,
    historicalCompleteness: history.historicalCompleteness };
  await writeCampaignFile(store, BASELINE_KEY, baseline, { onlyIfNew: true });
  // Verify the winning anchor and re-read history before attempting activation.
  const current = await readHistory(store);
  if (current?.data.initialization === 'PROVISIONAL') {
    await writeCampaignFile(store, LEDGER_KEY, { ...current.data, initialization: 'ESTABLISHED' },
      { onlyIfMatch: current.etag });
  }
  // The caller re-reads even after an unsuccessful CAS; never return a stale batch.
}

export async function readCampaignPanel({ store = campaignStore() } = {}) {
  const row = await readHistory(store);
  return row && row.data.initialization !== 'PROVISIONAL'
    ? campaignPanel(row.data) : { status: 'UNINITIALIZED', campaignId: REGULAR_CAMPAIGN };
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
  if (body.action === 'prepare' && Object.keys(body).length !== 2) throw fail('La selección se calcula en el servidor.', 400);
  for (let attempt = 0; attempt < 6; attempt++) {
    const instant = now();
    if (!validDate(instant)) throw fail('Fecha de campaña no válida.');
    const row = await readHistory(store);
    if (row?.data.initialization === 'PROVISIONAL') {
      if (body.action !== 'prepare') throw fail('La inicialización de la campaña todavía no está completa.');
      await finishInitialization(store, row.data);
      continue;
    }
    let history = row ? structuredClone(row.data) : null;
    if (!history) {
      if (body.action !== 'prepare') throw fail('No existe un ciclo activo.');
      history = { schemaVersion: 1, campaignId: REGULAR_CAMPAIGN, cycleId: idFactory(),
        startedAt: instant, historicalCompleteness: 'UNRECONCILED', revision: 1,
        preparationEvidence: structuredClone(evidence), batches: [] };
    }
    let batch, packet, changed = false;
    if (body.action === 'prepare') {
      packet = await loadPacket();
      const selected = selectRegularCampaign(packet, history, instant);
      // Reopening today's incomplete handoff is a retry, not a new preparation.
      batch = history.batches.findLast(b => b.passId === PRIORITY_PASS && b.date === dateInParaguay(instant) && b.phase === selected.phase &&
        handoffCampaign(packet, history, b).regularCampaign.selectedProductIds.length);
      if (!batch) {
        if (!selected.products.length) throw fail('No quedan Items elegibles sin publicar en la pasada prioritaria. Reutilizá las fotos y mensajes existentes para nuevas publicaciones; no se preparó otro lote.');
        batch = { id: idFactory(), campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId,
          date: dateInParaguay(instant), preparedAt: instant, phase: selected.phase, passId: PRIORITY_PASS,
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
        // Only the winning provisional record chooses the cycle and initial batch.
        // Activation later uses its ETag, so stale recovery cannot recreate lost history.
        await writeCampaignFile(store, LEDGER_KEY, { ...history, initialization: 'PROVISIONAL' }, { onlyIfNew: true });
        continue;
      }
      const saved = await writeCampaignFile(store, LEDGER_KEY, history, { onlyIfMatch: row.etag });
      if (!saved.modified) continue;
      history = saved.readback;
      batch = history.batches.find(candidate => candidate.id === batch.id);
    }
    return { campaign: campaignPanel(history), packet: packet ? handoffCampaign(packet, history, batch) : undefined };
  }
  throw fail('El historial cambió en otra sesión. Volvé a intentar con datos actuales.');
}
