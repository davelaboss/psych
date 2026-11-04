import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getStore } from '@netlify/blobs';
import { PREPARATION_EVIDENCE } from './regular-campaign-seed.mjs';

export const REGULAR_CAMPAIGN = 'regular-chatgpt-daily-v1';
export const PRIORITY_PASS = 'priority-over-50000-v1';
export const ASSIGNMENT_POLICY = 'david-delayed-maria-immediate-v1';
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
  const { revision, batches, initialization, schemaVersion, supersessions = [], deferrals = [], ...fixed } = expected;
  const { revision: currentRevision, batches: currentBatches, initialization: currentInitialization,
    schemaVersion: currentSchema, supersessions: currentSupersessions = [], deferrals: currentDeferrals = [], ...currentFixed } = actual;
  if (currentRevision < revision || currentSchema < schemaVersion || !isDeepStrictEqual(currentFixed, fixed) ||
      !supersessions.every(event => currentSupersessions.some(current => isDeepStrictEqual(current, event))) ||
      !deferrals.every(event => currentDeferrals.some(current => isDeepStrictEqual(current, event))) ||
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
  if (!history || ![1, 2, 3].includes(history.schemaVersion) || history.campaignId !== REGULAR_CAMPAIGN ||
      (history.schemaVersion < 3 && history.deferrals !== undefined) ||
      (history.schemaVersion === 3 && (history.initialization === 'PROVISIONAL' || !Array.isArray(history.deferrals))) ||
      (history.schemaVersion === 1 && history.supersessions !== undefined) ||
      (history.schemaVersion === 2 && (history.initialization === 'PROVISIONAL' ||
        !Array.isArray(history.supersessions) || !history.supersessions.length)) ||
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
        ![undefined, ASSIGNMENT_POLICY].includes(batch.assignmentPolicy) ||
        batch.date !== dateInParaguay(batch.preparedAt) || !batch.assignments ||
        Object.keys(batch.assignments).sort().join(',') !== 'David,Maria') {
      throw fail('Lote de campaña no fiable.');
    }
    batchIds.add(batch.id);
    if (batch.advancement !== undefined) {
      const event = batch.advancement;
      const prior = history.batches.find(b => b.id === event?.fromBatchId);
      if (history.schemaVersion !== 3 || !event || Object.keys(event).sort().join(',') !==
          'fromBatchId,reason,requestedBy,sourceRevision' || !prior || prior === batch ||
          !batchIds.has(prior.id) || Date.parse(prior.preparedAt) > Date.parse(batch.preparedAt) ||
          event.requestedBy !== 'SELLER_ADMIN' || !Number.isSafeInteger(event.sourceRevision) ||
          event.sourceRevision < 1 || event.sourceRevision >= history.revision ||
          typeof event.reason !== 'string' || !event.reason.trim() || event.reason.length > 1000) throw fail('Avance de lote no fiable.');
    }
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
  const eventIds = new Set(), targets = new Set();
  for (const event of history.supersessions || []) {
    const batch = history.batches.find(b => b.id === event?.batchId);
    if (!event || Object.keys(event).sort().join(',') !==
        'approvalReference,batchId,id,person,productIds,reason,recordedAt,recordedBy,sourceRevision' ||
        !validId(event.id) || eventIds.has(event.id) || !batch || batch.passId !== PRIORITY_PASS ||
        !people.includes(event.person) || !validDate(event.recordedAt) || Date.parse(event.recordedAt) < Date.parse(batch.preparedAt) ||
        event.recordedBy !== 'GOVERNANCE_OPERATOR' || !Number.isSafeInteger(event.sourceRevision) ||
        event.sourceRevision < 1 || event.sourceRevision >= history.revision ||
        ![event.reason, event.approvalReference].every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 1000) ||
        !Array.isArray(event.productIds) || !event.productIds.length || event.productIds.length > 5 ||
        new Set(event.productIds).size !== event.productIds.length) throw fail('Sustitución de asignaciones no fiable.');
    eventIds.add(event.id);
    for (const id of event.productIds) {
      const item = batch.assignments[event.person].find(p => p.productId === id);
      const target = `${batch.id}/${event.person}/${id}`;
      if (!item || item.postedAt !== null || targets.has(target)) throw fail('No se puede sustituir una publicación confirmada o una asignación inexistente.');
      targets.add(target);
    }
  }
  for (const event of history.deferrals || []) {
    const batch = history.batches.find(b => b.id === event?.batchId);
    if (!event || Object.keys(event).sort().join(',') !==
        'approvalReference,batchId,id,person,productIds,reason,recordedAt,recordedBy,sourceRevision' ||
        !validId(event.id) || eventIds.has(event.id) || !batch || batch.passId !== PRIORITY_PASS ||
        !people.includes(event.person) || !validDate(event.recordedAt) || Date.parse(event.recordedAt) < Date.parse(batch.preparedAt) ||
        event.recordedBy !== 'GOVERNANCE_OPERATOR' || !Number.isSafeInteger(event.sourceRevision) ||
        event.sourceRevision < 1 || event.sourceRevision >= history.revision ||
        ![event.reason, event.approvalReference].every(s => typeof s === 'string' && s.trim() && s.length <= 1000) ||
        !Array.isArray(event.productIds) || !event.productIds.length || event.productIds.length > 5 ||
        new Set(event.productIds).size !== event.productIds.length) throw fail('Aplazamiento no fiable.');
    eventIds.add(event.id);
    for (const id of event.productIds) {
      const item = batch.assignments[event.person].find(p => p.productId === id);
      const target = `${batch.id}/${event.person}/${id}`;
      if (!item || targets.has(target) || item.postedAt && Date.parse(item.postedAt) > Date.parse(event.recordedAt)) {
        throw fail('Aplazamiento incompatible con la asignación o publicación.');
      }
      targets.add(target);
    }
  }
  return history;
}

function activeAssignments(history, batch, person) {
  const excluded = new Set([...(history.supersessions || []), ...(history.deferrals || [])].filter(event =>
    event.batchId === batch.id && event.person === person).flatMap(event => event.productIds));
  return batch.assignments[person].filter(item => !excluded.has(item.productId));
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
        !Number.isSafeInteger(p.itemNumber) || p.itemNumber < 1 || !p.title || !p.category || !['IMMEDIATE', 'DELAYED'].includes(p.saleMode) ||
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
  const { posted } = coverage(history);
  // Explicit withdrawals apply to this cycle's priority pass, never inventory or POSTED coverage.
  const withdrawn = new Set((history.supersessions || []).flatMap(event => event.productIds));
  const deferred = new Set((history.deferrals || []).flatMap(event => event.productIds));
  const pending = new Set(history.batches.filter(b => b.passId === PRIORITY_PASS).flatMap(b => people.flatMap(person =>
    activeAssignments(history, b, person).filter(p => !p.postedAt && !posted.has(p.productId)).map(p => p.productId))));
  const unconfirmed = products.filter(p => !posted.has(p.productId) && !withdrawn.has(p.productId) && !deferred.has(p.productId));
  const firstPass = unconfirmed.filter(p => !pending.has(p.productId));
  const byIdentity = (a, b) => a.itemNumber - b.itemNumber || a.productId.localeCompare(b.productId);
  const ranked = firstPass.sort((a, b) => b.askingPricePYG - a.askingPricePYG || byIdentity(a, b));
  const delayed = ranked.filter(p => p.saleMode === 'DELAYED');
  const immediate = ranked.filter(p => p.saleMode === 'IMMEDIATE');
  const davidDelayed = delayed.slice(0, 5);
  // Keep David-first ordering for the permitted immediate fill; never borrow delayed stock for Maria.
  const davidFill = immediate.slice(0, 5 - davidDelayed.length);
  const assignments = { David: [...davidDelayed, ...davidFill], Maria: immediate.slice(davidFill.length, davidFill.length + 5) };
  return { phase: 'FIRST_PASS', assignments, products: people.flatMap(person => assignments[person]),
    eligibleUnconfirmedCount: unconfirmed.length, eligibleUnassignedCount: firstPass.length, totalMarketable: products.length,
    diagnostics: { eligible: products.length, immediate: products.filter(p => p.saleMode === 'IMMEDIATE').length,
      delayed: products.filter(p => p.saleMode === 'DELAYED').length, confirmedPosted: posted.size,
      eligiblePosted: products.filter(p => posted.has(p.productId)).length,
      eligiblePending: unconfirmed.filter(p => pending.has(p.productId)).length,
      eligibleWithdrawn: products.filter(p => withdrawn.has(p.productId)).length,
      eligibleDeferred: products.filter(p => deferred.has(p.productId) && !posted.has(p.productId)).length,
      eligibleUnassigned: firstPass.length, nextBatchCounts: Object.fromEntries(people.map(person => [person, assignments[person].length])),
      progression: firstPass.length ? (pending.size ? 'PENDING_WITH_FRESH_INVENTORY' : 'FRESH_INVENTORY') :
        (unconfirmed.length ? 'PENDING_ONLY' : 'NO_UNASSIGNED_PRIORITY_INVENTORY') } };
}

export function campaignPanel(history) {
  validateCampaignHistory(history);
  const { posted } = coverage(history);
  return {
    status: 'READY', campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId,
    passId: PRIORITY_PASS, passStartedAt: history.batches.find(b => b.passId === PRIORITY_PASS)?.preparedAt || null,
    startedAt: history.startedAt, historicalCompleteness: history.historicalCompleteness, revision: history.revision,
    latestBatchId: history.batches.at(-1)?.id || null,
    confirmedPostedCount: posted.size,
    ...(history.deferrals ? { deferrals: history.deferrals.map(event => ({ ...event,
      date: history.batches.find(b => b.id === event.batchId).date,
      itemNumbers: event.productIds.map(id => history.batches.find(b => b.id === event.batchId)
        .assignments[event.person].find(p => p.productId === id).itemNumber),
    })) } : {}),
    ...(history.supersessions ? { supersessions: history.supersessions.map(event => ({ ...event,
      date: history.batches.find(batch => batch.id === event.batchId).date,
      itemNumbers: event.productIds.map(id => history.batches.find(batch => batch.id === event.batchId)
        .assignments[event.person].find(item => item.productId === id).itemNumber),
    })) } : {}),
    pendingBatches: history.batches.filter(b => b.passId === PRIORITY_PASS).map(batch => ({
      id: batch.id, date: batch.date, phase: batch.phase,
      assignmentPolicy: batch.assignmentPolicy || null,
      requiresAssignmentReview: batch.assignmentPolicy !== ASSIGNMENT_POLICY,
      assignments: Object.fromEntries(people.map(person => [person, activeAssignments(history, batch, person)
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

export async function readCampaignPanel({ store = campaignStore(), packet } = {}) {
  const row = await readHistory(store);
  return row && row.data.initialization !== 'PROVISIONAL'
    ? { ...campaignPanel(row.data), ...(packet ? { diagnostics: selectRegularCampaign(packet, row.data).diagnostics } : {}) }
    : { status: 'UNINITIALIZED', campaignId: REGULAR_CAMPAIGN };
}

function handoffCampaign(packet, history, batch) {
  const selection = selectRegularCampaign(packet, history, batch.preparedAt);
  const marketable = new Map(eligibleProducts(packet).map(p => [p.productId, p]));
  const { posted } = coverage(history);
  const assignments = Object.fromEntries(people.map(person => [person, activeAssignments(history, batch, person)
    .filter(p => marketable.has(p.productId) && (person !== 'Maria' || marketable.get(p.productId).saleMode === 'IMMEDIATE') &&
      !p.postedAt && (batch.phase === 'PHASE_2' || !posted.has(p.productId)))
    .map(p => p.productId)]));
  return {
    ...packet,
    regularCampaign: {
      ...campaignPanel(history), pendingBatches: undefined, batchId: batch.id, phase: batch.phase,
      assignmentPolicy: batch.assignmentPolicy,
      eligibleUnconfirmedCount: selection.eligibleUnconfirmedCount, eligibleUnassignedCount: selection.eligibleUnassignedCount,
      diagnostics: selection.diagnostics, totalMarketable: selection.totalMarketable,
      assignments, selectedProductIds: people.flatMap(person => assignments[person]),
    },
  };
}

export async function updateRegularCampaign({ body, loadPacket, store = campaignStore(),
  now = () => new Date().toISOString(), idFactory = randomUUID, evidence = PREPARATION_EVIDENCE }) {
  if (!body || body.campaignId !== REGULAR_CAMPAIGN || !['prepare', 'advance', 'confirm'].includes(body.action) ||
      Object.keys(body).some(key => !['action', 'campaignId', 'cycleId', 'batchId', 'person', 'productIds', 'confirmation', 'expectedRevision', 'reason', 'publishedAt'].includes(key))) {
    throw fail('Acción exclusiva de la campaña regular no válida.', 400);
  }
  if (body.action === 'prepare' && Object.keys(body).length !== 2) throw fail('La selección se calcula en el servidor.', 400);
  if (body.action === 'advance' && (Object.keys(body).sort().join(',') !==
      'action,batchId,campaignId,cycleId,expectedRevision,reason' || !validId(body.batchId) ||
      !Number.isSafeInteger(body.expectedRevision) || typeof body.reason !== 'string' ||
      !body.reason.trim() || body.reason.length > 1000)) throw fail('Revisá el lote y registrá el motivo del avance.', 400);
  if (body.action === 'confirm' && (body.expectedRevision !== undefined || body.reason !== undefined)) throw fail('Confirmación no válida.', 400);
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
    if (['prepare', 'advance'].includes(body.action)) {
      packet = await loadPacket();
      const selected = selectRegularCampaign(packet, history, instant);
      if (body.action === 'advance' && (body.cycleId !== history.cycleId || body.expectedRevision !== history.revision ||
          body.batchId !== history.batches.at(-1)?.id)) throw fail('El historial cambió. Revisá el último lote antes de avanzar.');
      // Finish an eligible pending handoff before selecting again, even on a new date.
      const modes = new Map(eligibleProducts(packet).map(p => [p.productId, p.saleMode]));
      // Preserve old assignments for true late confirmations. Only current-policy, still-compatible
      // batches may be reused for new production; never rewrite a legacy Maria assignment in place.
      batch = body.action === 'prepare' && history.batches.findLast(b => b.passId === PRIORITY_PASS && b.phase === selected.phase &&
        b.assignmentPolicy === ASSIGNMENT_POLICY &&
        activeAssignments(history, b, 'Maria').every(p => p.postedAt || !modes.has(p.productId) || modes.get(p.productId) === 'IMMEDIATE') &&
        handoffCampaign(packet, history, b).regularCampaign.selectedProductIds.length);
      if (!batch) {
        if (!selected.products.length) throw fail('No quedan Items elegibles sin publicar y sin asignación en la pasada prioritaria. Reutilizá las fotos y mensajes existentes para nuevas publicaciones; no se preparó otro lote.');
        batch = { id: idFactory(), campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId,
          date: dateInParaguay(instant), preparedAt: instant, phase: selected.phase, passId: PRIORITY_PASS,
          assignmentPolicy: ASSIGNMENT_POLICY,
          ...(body.action === 'advance' ? { advancement: { fromBatchId: body.batchId, reason: body.reason.trim(),
            requestedBy: 'SELLER_ADMIN', sourceRevision: history.revision } } : {}),
          assignments: Object.fromEntries(people.map(person => [person, selected.assignments[person]
            .map(p => ({ productId: p.productId, itemNumber: p.itemNumber, postedAt: null }))])) };
        if (body.action === 'advance') { history.schemaVersion = 3; history.deferrals ??= []; }
        history.batches.push(batch); changed = true;
      }
    } else {
      if (body.cycleId !== history.cycleId || !people.includes(body.person) ||
          body.confirmation !== 'PUBLISHED_REGULAR_CAMPAIGN' || !Array.isArray(body.productIds) ||
          !body.productIds.length || body.productIds.length > 5 || new Set(body.productIds).size !== body.productIds.length) {
        throw fail('Confirmá únicamente los Items realmente publicados de este lote regular.', 400);
      }
      batch = history.batches.find(b => b.id === body.batchId);
      const publishedAt = body.publishedAt ?? instant;
      if (!validDate(publishedAt) || Date.parse(publishedAt) > Date.parse(instant) || !batch ||
          Date.parse(publishedAt) < Date.parse(batch.preparedAt) || body.productIds.some(id =>
            !batch.assignments[body.person].some(p => p.productId === id) ||
            (history.supersessions || []).some(e => e.batchId === batch.id && e.person === body.person && e.productIds.includes(id)) ||
            (history.deferrals || []).some(e => e.batchId === batch.id && e.person === body.person && e.productIds.includes(id) &&
              (body.publishedAt === undefined || Date.parse(publishedAt) > Date.parse(e.recordedAt))))) {
        throw fail('Los Items no pertenecen a la persona y lote indicados.', 400);
      }
      for (const item of batch.assignments[body.person]) if (body.productIds.includes(item.productId) && !item.postedAt) {
        item.postedAt = publishedAt; item.confirmedBy = 'SELLER_ADMIN'; changed = true;
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
    return { campaign: { ...campaignPanel(history), ...(packet ? { diagnostics: selectRegularCampaign(packet, history).diagnostics } : {}) },
      packet: packet ? handoffCampaign(packet, history, batch) : undefined };
  }
  throw fail('El historial cambió en otra sesión. Volvé a intentar con datos actuales.');
}

// Operator-only: no HTTP action, selection, publication, baseline write or automatic execution.
export async function supersedeCampaignAssignments({ operation, store = campaignStore(),
  now = () => new Date().toISOString() }) {
  if (!operation || Object.keys(operation).sort().join(',') !==
      'approvalReference,batchId,campaignId,cycleId,expectedEtag,expectedRevision,id,person,productIds,reason' ||
      operation.campaignId !== REGULAR_CAMPAIGN || !validEtag(operation.expectedEtag) ||
      !Number.isSafeInteger(operation.expectedRevision)) throw fail('Operación de conciliación no válida.', 400);
  const row = await readHistory(store);
  if (!row || row.data.initialization === 'PROVISIONAL' || row.data.cycleId !== operation.cycleId) {
    throw fail('No coincide el ciclo establecido.');
  }
  const { id, batchId, person, productIds, reason, approvalReference } = operation;
  const eventFields = { id, batchId, person, productIds, reason, approvalReference,
    sourceRevision: operation.expectedRevision, recordedBy: 'GOVERNANCE_OPERATOR' };
  const prior = row.data.supersessions?.find(event => event.id === id);
  if (prior) {
    const { recordedAt, ...persisted } = prior;
    if (!isDeepStrictEqual(persisted, eventFields)) throw fail('El identificador ya pertenece a otra conciliación.');
    return { changed: false, history: row.data, campaign: campaignPanel(row.data) };
  }
  if (row.etag !== operation.expectedEtag || row.data.revision !== operation.expectedRevision) {
    throw fail('El historial cambió. Revisá y autorizá nuevamente la operación.');
  }
  const history = structuredClone(row.data);
  history.schemaVersion = Math.max(history.schemaVersion, 2);
  history.revision++;
  history.supersessions = [...(history.supersessions || []), { ...eventFields, recordedAt: now() }];
  validateCampaignHistory(history);
  const saved = await writeCampaignFile(store, LEDGER_KEY, history, { onlyIfMatch: row.etag });
  if (!saved.modified) throw fail('El historial cambió. Revisá y autorizá nuevamente la operación.');
  return { changed: true, history: saved.readback, campaign: campaignPanel(saved.readback) };
}

// Separately approved operator action; not exposed through the HTTP endpoint.
// Deferred products stay excluded for this pass. A truthful publication before the
// deferral may still be recorded with its explicit publishedAt; no event is erased.
export async function deferCampaignAssignments({ operation, store = campaignStore(),
  now = () => new Date().toISOString() }) {
  if (!operation || Object.keys(operation).sort().join(',') !==
      'approvalReference,batchId,campaignId,cycleId,expectedEtag,expectedRevision,id,person,productIds,reason' ||
      operation.campaignId !== REGULAR_CAMPAIGN || !validEtag(operation.expectedEtag) ||
      !Number.isSafeInteger(operation.expectedRevision)) throw fail('Operación de aplazamiento no válida.', 400);
  const row = await readHistory(store);
  if (!row || row.data.initialization === 'PROVISIONAL' || row.data.cycleId !== operation.cycleId) throw fail('No coincide el ciclo establecido.');
  const { id, batchId, person, productIds, reason, approvalReference } = operation;
  const fields = { id, batchId, person, productIds, reason, approvalReference,
    sourceRevision: operation.expectedRevision, recordedBy: 'GOVERNANCE_OPERATOR' };
  const prior = row.data.deferrals?.find(e => e.id === id);
  if (prior) {
    const { recordedAt, ...persisted } = prior;
    if (!isDeepStrictEqual(persisted, fields)) throw fail('El identificador ya pertenece a otro aplazamiento.');
    return { changed: false, history: row.data, campaign: campaignPanel(row.data) };
  }
  if (row.etag !== operation.expectedEtag || row.data.revision !== operation.expectedRevision) throw fail('El historial cambió. Revisá y autorizá nuevamente la operación.');
  const batch = row.data.batches.find(b => b.id === batchId);
  if (!batch || !people.includes(person) || !Array.isArray(productIds) || productIds.some(id =>
    !activeAssignments(row.data, batch, person).some(p => p.productId === id && p.postedAt === null))) throw fail('Solo se aplazan asignaciones activas sin confirmar.');
  const history = structuredClone(row.data);
  history.schemaVersion = 3; history.revision++;
  history.deferrals = [...(history.deferrals || []), { ...fields, recordedAt: now() }];
  validateCampaignHistory(history);
  const saved = await writeCampaignFile(store, LEDGER_KEY, history, { onlyIfMatch: row.etag });
  if (!saved.modified) throw fail('El historial cambió. Revisá y autorizá nuevamente la operación.');
  return { changed: true, history: saved.readback, campaign: campaignPanel(saved.readback) };
}
