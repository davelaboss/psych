// Shared, pure owner-state rules. No storefront imports or publication side effects.
export const VOLUME = 5;
export const FIRST_ITEM = 510;
export const RETIRED = Object.freeze([342, 420, 437, 442, 444, 469, 507, 509]);
export const STATUS_LABELS = Object.freeze({ unreviewed: 'Sin revisar', missing: 'Falta información', approved: 'Aprobado', 're-review': 'Requiere nueva revisión' });
export const PUBLIC_FIELDS = Object.freeze(['itemNumber', 'id', 'slug', 'title', 'category', 'asking', 'description', 'condition', 'knownDefects', 'functionality', 'measurements', 'quantityTotal', 'saleMode', 'saleStructure', 'includedAccessories', 'notIncludedVisible', 'requiresVehicle', 'requiresLoadingHelp', 'pickupWindowStart', 'pickupWindowEnd', 'finalPaymentWindowStart', 'finalPaymentWindowEnd']);
export const EDIT_FIELDS = Object.freeze(PUBLIC_FIELDS.filter(key => !['itemNumber', 'id', 'slug', 'pickupWindowStart', 'pickupWindowEnd', 'finalPaymentWindowStart', 'finalPaymentWindowEnd'].includes(key)));
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const slugify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function pyg(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const clean = String(value).trim().replace(/^Gs\.?\s*/i, '').replace(/\./g, '').replace(/\s/g, '');
  assert(/^\d+$/.test(clean), 'Precio inválido; use guaraníes o el atajo en miles.');
  const n = Number(clean), amount = n < 1000 ? n * 1000 : n;
  assert(Number.isSafeInteger(amount) && amount > 0, 'Precio inválido.');
  return amount;
}
export function pricingResearch(input = {}) {
  const p = { originalPricePaid: null, currentRetailPrice: null, localUsedMarketRange: null, suggestedAskingPrice: null, fastSalePrice: null, privateSellerFloor: null, confidence: 'LOW', rationale: '', uncertainties: '', sources: [], comparables: [], ...clone(input) };
  assert(['LOW', 'MEDIUM', 'HIGH'].includes(p.confidence), 'Confianza de precio inválida.');
  for (const url of p.sources) assert(/^https?:\/\//.test(url), 'URL de investigación inválida.');
  const useful = p.comparables.filter(c => c.itemSpecific === true && c.localParaguay === true && Number.isInteger(c.price) && c.price > 0 && p.sources.includes(c.url) && c.observedAt && c.comparison);
  const supported = p.confidence !== 'LOW' && useful.length > 0 && p.rationale.trim();
  if (!supported) { p.suggestedAskingPrice = null; p.fastSalePrice = null; }
  if (p.localUsedMarketRange !== null) {
    const used = useful.filter(c => c.market === 'used');
    assert(used.length >= 2, 'El rango requiere al menos dos comparables locales usados.');
    assert(equal(p.localUsedMarketRange, [Math.min(...used.map(c => c.price)), Math.max(...used.map(c => c.price))]), 'El rango debe coincidir con los comparables.');
  }
  for (const key of ['originalPricePaid', 'currentRetailPrice', 'suggestedAskingPrice', 'fastSalePrice', 'privateSellerFloor']) assert(p[key] === null || (Number.isInteger(p[key]) && p[key] > 0), `Precio de investigación inválido: ${key}.`);
  return p;
}
export function active(state) { return state.items.filter(item => !item.retired); }
export function publicPhotos(item) { return item.photos.filter(photo => photo.role === 'public'); }
export function applyTiming(product) {
  const delayed = product.saleMode === 'DELAYED';
  Object.assign(product, { pickupWindowStart: delayed ? '2026-12-09' : null, pickupWindowEnd: delayed ? '2026-12-12' : null, finalPaymentWindowStart: delayed ? '2026-12-01' : null, finalPaymentWindowEnd: delayed ? '2026-12-08' : null });
}
export function identity(state) {
  assert(state.schemaVersion === 1 && state.volume === 5 && /^volume5-/.test(state.batchId), 'Identidad inválida: se requiere Volume 5.');
  assert(['real', 'fixture'].includes(state.mode), 'Modo inválido.');
  assert(Array.isArray(state.items) && Array.isArray(state.sources), 'Estado incompleto.');
  for (const item of state.items) {
    const id = item.product.itemNumber;
    assert(state.mode === 'fixture' ? /^fixture-v5-\d+$/.test(String(id)) : Number.isInteger(id) && id >= FIRST_ITEM && !RETIRED.includes(id), 'Número de Item inválido o retirado.');
    assert(item.product.id === (state.mode === 'fixture' ? `volume5-${id}` : `real-202610-volume5-${id}`), 'ID debe identificar Volume 5.');
    assert(item.product.slug.endsWith(`-item-${id}`), 'Slug incompatible con el Item.');
    for (const photo of item.photos) assert(/^images\/volume-5\/v5-[a-z0-9-]+\.webp$/.test(photo.path), 'Ruta de imagen debe identificar Volume 5.');
  }
  return true;
}
export function reconcile(state) {
  identity(state);
  const sourceIds = state.sources.map(p => p.sourceId);
  assert(new Set(sourceIds).size === sourceIds.length, 'Fuente duplicada.');
  const assigned = active(state).flatMap(i => i.photos);
  assert(new Set(assigned.map(p => p.sourceId)).size === assigned.length, 'Foto asignada más de una vez.');
  assert(new Set(assigned.map(p => p.path)).size === assigned.length, 'Ruta de salida duplicada.');
  assert(equal([...assigned.map(p => p.sourceId)].sort(), [...sourceIds].sort()), 'Foto sin asignar o pérdida de fotos.');
  for (const photo of assigned) {
    assert(['public', 'reference'].includes(photo.role), 'Uso de foto inválido.');
    if (photo.role === 'reference') assert(photo.justification?.trim(), 'Una foto de referencia requiere justificación explícita.');
    const source = state.sources.find(s => s.sourceId === photo.sourceId);
    assert(source.optimizedPath === photo.path, 'Identidad de foto alterada.');
  }
  for (const key of ['itemNumber', 'id', 'slug']) assert(new Set(state.items.map(i => i.product[key])).size === state.items.length, `Identificador duplicado: ${key}.`);
  return { inputPhotos: sourceIds.length, publicCandidatePhotos: assigned.filter(p => p.role === 'public').length, referenceOnlyPhotos: assigned.filter(p => p.role === 'reference').length, unassignedPhotos: 0 };
}
const leak = /\b(?:MEDIR|REMOVE|NEEDS_REVIEW|reviewer|review|confidence|todo|owner.confirmed|seller.confirmed|IA|AI)\b|revisor|inteligencia artificial|según (?:las notas|el vendedor)|pendiente de revisión|falta (?:confirmar|probar|medir)/i;
const english = /\b(?:sold separately|price per unit|set of|good condition|works(?: very well)?|does not work|need to test|not included|included with|small|medium|large|pending|unknown|blender|chair|table|shelf|kitchen|furniture)\b/i;
export function publicErrors(product) {
  const errors = [];
  for (const key of ['title', 'category', 'description']) if (!String(product[key] || '').trim()) errors.push(`Falta ${key === 'title' ? 'nombre' : key === 'category' ? 'categoría' : 'descripción'}.`);
  if (!Number.isInteger(product.quantityTotal) || product.quantityTotal < 1) errors.push('Cantidad inválida.');
  if (product.asking !== null && (!Number.isInteger(product.asking) || product.asking <= 0)) errors.push('Precio actual inválido.');
  if (!['IMMEDIATE', 'DELAYED'].includes(product.saleMode)) errors.push('Modalidad de retiro inválida.');
  if (!['individual', 'set', 'flexible', 'undecided'].includes(product.saleStructure)) errors.push('Estructura de venta inválida.');
  if (typeof product.requiresVehicle !== 'boolean' || typeof product.requiresLoadingHelp !== 'boolean') errors.push('Logística inválida.');
  const copy = [product.title, product.description, product.condition, product.knownDefects, product.functionality, product.measurements, product.notIncludedVisible, ...product.includedAccessories];
  if (copy.some(value => leak.test(String(value)))) errors.push('Hay texto interno en el contenido público.');
  if (copy.some(value => english.test(String(value)))) errors.push('Hay texto en inglés en el contenido público.');
  if (product.description && !/[.!?…]$/.test(product.description.trim())) errors.push('La descripción debe terminar con puntuación.');
  if (product.quantityTotal > 1 && product.saleStructure === 'individual' && (!product.title.endsWith('(por unidad)') || !product.description.includes(String(product.quantityTotal)) || !/se venden (?:individualmente|por separado)/i.test(product.description) || !/precio por unidad/i.test(product.description))) errors.push('Indique cantidad disponible, venta individual y precio por unidad.');
  if (product.saleStructure === 'set' && /\(por unidad\)/i.test(product.title)) errors.push('Un juego no puede titularse por unidad.');
  const excluded = slugify(product.notIncludedVisible);
  if (product.includedAccessories.some(value => excluded && slugify(value) && (`-${excluded}-`.includes(`-${slugify(value)}-`) || `-${slugify(value)}-`.includes(`-${excluded}-`)))) errors.push('Incluido y no incluido se contradicen.');
  return errors;
}
export function approvalErrors(item) {
  const errors = publicErrors(item.product);
  if (/^(?:Producto por identificar|Producto separado)$/i.test(item.product.title)) errors.push('Falta identificar y nombrar el producto.');
  if (item.product.asking === null) errors.push('Falta precio actual del vendedor.');
  if (!item.product.condition) errors.push('Falta confirmar condición.');
  if (!item.product.knownDefects && !item.confirmedFields.includes('knownDefects')) errors.push('Falta confirmar si hay defectos conocidos.');
  if (!item.product.functionality || item.product.functionality === 'Falta probar') errors.push('Falta confirmar funcionamiento.');
  if (item.product.saleStructure === 'undecided' || !item.groupingConfirmed) errors.push('Falta confirmar agrupación y estructura de venta.');
  if (item.questions.some(q => q.required && !q.resolved)) errors.push('Hay preguntas obligatorias sin resolver.');
  if (!publicPhotos(item).length) errors.push('Faltan fotos públicas.');
  if (!publicPhotos(item).some(p => p.sourceId === item.coverSourceId)) errors.push('Elija una foto principal pública para producción.');
  if (!item.copyChecked) errors.push('Falta la revisión de redacción en español.');
  return errors;
}
export function orderedPhotos(item) {
  const photos = publicPhotos(item), cover = photos.find(p => p.sourceId === item.coverSourceId);
  assert(cover, 'Foto principal inexistente o solo de referencia.');
  return [cover, ...photos.filter(p => p !== cover)];
}
export function finalizedProduct(item) {
  return { ...Object.fromEntries(PUBLIC_FIELDS.map(key => [key, clone(item.product[key])])), photos: orderedPhotos(item).map(p => `/${p.path}`), coverIndex: 0, status: 'NEEDS_REVIEW', needsReview: true };
}
export function auditRoundTrip(state, batch, projection) {
  reconcile(state);
  assert(state.mode === 'real' && active(state).length > 0, 'Un ensayo o lote vacío no puede pasar a producción.');
  const items = active(state);
  assert(batch.length === items.length && projection.length === items.length, 'Cobertura incompleta del lote o catálogo público.');
  const result = [];
  for (const item of items) {
    assert(item.reviewStatus === 'approved' && !approvalErrors(item).length, `Item ${item.product.itemNumber}: aprobación incompleta.`);
    const expected = finalizedProduct(item), b = batch.find(p => p.id === expected.id), p = projection.find(p => p.id === expected.id);
    assert(b && p, 'Falta producto en lote o proyección.');
    for (const field of PUBLIC_FIELDS) {
      const publicKey = field === 'asking' ? 'askingPricePYG' : field;
      assert(equal(expected[field], b[field]) && equal(expected[field], p[publicKey]), `Item ${expected.itemNumber}: no coincide ${field}.`);
    }
    assert(equal(b.photos, expected.photos) && equal(p.images, expected.photos), `Item ${expected.itemNumber}: no coincide orden o identidad de fotos.`);
    assert(b.coverIndex === 0, 'coverIndex debe normalizarse a 0.');
    result.push({ item: expected.itemNumber, ownerApprovedCoverSource: item.coverSourceId, finalPhotos0: b.photos[0], publicImages0: p.images[0], match: 'YES' });
  }
  return result;
}
function touched(item) {
  item.edited = true;
  if (item.reviewStatus === 'approved') item.reviewStatus = 're-review';
}
function find(state, id) {
  const item = active(state).find(i => String(i.product.itemNumber) === String(id));
  assert(item, 'Item activo no encontrado.'); return item;
}
function patch(item, changes, owner) {
  for (const [key, raw] of Object.entries(changes)) {
    assert(EDIT_FIELDS.includes(key) || ['ownerNotes', 'pricingDecision'].includes(key), 'Campo no editable.');
    // Asking is always a seller decision, even when no prior confirmation flag exists.
    if (!owner && key === 'asking') continue;
    if (!owner && item.confirmedFields.includes(key)) continue;
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) continue;
    let value = raw === 'REMOVE' ? (Array.isArray(item.product[key]) ? [] : key === 'asking' ? null : '') : raw;
    if (key === 'asking' && value !== null) value = pyg(value);
    if (['ownerNotes', 'pricingDecision'].includes(key)) item[key] = value;
    else item.product[key] = value;
    if (owner && !item.confirmedFields.includes(key)) item.confirmedFields.push(key);
  }
  item.product.slug = `${slugify(item.product.title)}-item-${item.product.itemNumber}`;
  applyTiming(item.product);
}
export function reduceState(input, operation, { newItemNumber } = {}) {
  const state = clone(input), item = operation.itemNumber === undefined ? null : find(state, operation.itemNumber);
  const before = clone(item);
  switch (operation.type) {
    case 'edit': case 'assist': patch(item, operation.changes, operation.type === 'edit'); break;
    case 'cover': assert(publicPhotos(item).some(p => p.sourceId === operation.sourceId), 'La foto principal debe ser pública.'); item.coverSourceId = operation.sourceId; break;
    case 'order': {
      const photos = publicPhotos(item);
      assert(equal([...operation.sourceIds].sort(), photos.map(p => p.sourceId).sort()), 'El orden debe preservar todas las fotos una sola vez.');
      item.photos = [...operation.sourceIds.map(id => photos.find(p => p.sourceId === id)), ...item.photos.filter(p => p.role === 'reference')]; break;
    }
    case 'role': {
      const photo = item.photos.find(p => p.sourceId === operation.sourceId); assert(photo, 'Foto no encontrada.');
      assert(['public', 'reference'].includes(operation.role), 'Uso inválido.');
      if (operation.role === 'reference') assert(operation.justification?.trim(), 'Explique por qué será solo de referencia.');
      photo.role = operation.role; photo.justification = operation.justification || '';
      if (photo.role === 'reference' && item.coverSourceId === photo.sourceId) { item.coverSourceId = null; item.reviewStatus = 're-review'; }
      break;
    }
    case 'grouping': item.groupingConfirmed = operation.confirmed === true; break;
    case 'copy-check': item.copyChecked = operation.confirmed === true; break;
    case 'question': {
      const question = item.questions.find(q => q.id === operation.questionId); assert(question, 'Pregunta no encontrada.');
      assert(operation.answer?.trim(), 'La respuesta no puede estar vacía.');
      question.answer = operation.answer; question.resolved = true; break;
    }
    case 'research': item.pricing = pricingResearch(operation.pricing); break;
    case 'reset': {
      assert(operation.confirm === 'RESTABLECER', 'Confirme el restablecimiento.');
      // Reset only assistant proposals; owner-confirmed fields and all photos survive.
      for (const key of EDIT_FIELDS) if (!item.confirmedFields.includes(key)) item.product[key] = clone(item.initialProduct[key]);
      item.product.slug = `${slugify(item.product.title)}-item-${item.product.itemNumber}`; applyTiming(item.product); break;
    }
    case 'transfer': case 'split': case 'merge': {
      let target;
      if (operation.type === 'split') {
        assert(newItemNumber !== undefined && !state.items.some(i => i.product.itemNumber === newItemNumber), 'Se requiere un nuevo número inmutable.');
        target = clone(item); target.product.itemNumber = newItemNumber;
        target.product.id = state.mode === 'fixture' ? `volume5-${newItemNumber}` : `real-202610-volume5-${newItemNumber}`;
        target.product.title = 'Producto separado'; target.product.slug = `producto-separado-item-${newItemNumber}`;
        target.product.asking = null; target.photos = []; target.coverSourceId = null; target.reviewStatus = 're-review'; target.confirmedFields = []; target.groupingConfirmed = false; target.copyChecked = false;
        target.questions = [{ id: 'split', text: 'Confirmar los datos del producto separado.', required: true, resolved: false }];
        target.initialProduct = clone(target.product); state.items.push(target);
      } else target = find(state, operation.targetItemNumber);
      assert(target !== item, 'El destino debe ser otro Item.');
      const ids = operation.type === 'merge' ? item.photos.map(p => p.sourceId) : operation.sourceIds;
      assert(Array.isArray(ids) && ids.length && new Set(ids).size === ids.length, 'Seleccione fotos distintas.');
      const moved = ids.map(id => { const photo = item.photos.find(p => p.sourceId === id); assert(photo, 'Foto no encontrada en origen.'); return photo; });
      if (operation.type !== 'merge') assert(moved.length < item.photos.length, 'Use fusionar para transferir todas las fotos y retirar el Item.');
      // Transfer, verify target identities, then remove from source, then retire.
      target.photos.push(...moved);
      assert(moved.every(p => target.photos.includes(p)), 'Transferencia no verificada.');
      item.photos = item.photos.filter(p => !ids.includes(p.sourceId));
      if (ids.includes(item.coverSourceId)) { item.coverSourceId = null; item.reviewStatus = 're-review'; }
      if (operation.type === 'split') { item.coverSourceId = null; item.reviewStatus = 're-review'; }
      if (operation.type === 'merge') { assert(item.photos.length === 0, 'No retirar con fotos pendientes.'); item.retired = true; state.retiredItemNumbers.push(item.product.itemNumber); }
      item.groupingConfirmed = false; target.groupingConfirmed = false; touched(target);
      state.events.push({ type: 'TRANSFER_VERIFIED_BEFORE_RETIRE', from: item.product.itemNumber, to: target.product.itemNumber, sourceIds: ids });
      break;
    }
    case 'status': {
      assert(Object.hasOwn(STATUS_LABELS, operation.status), 'Estado de revisión inválido.');
      if (operation.status === 'approved') {
        assert(!approvalErrors(item).length, approvalErrors(item).join('\n'));
        item.confirmedFields = [...new Set([...item.confirmedFields, ...EDIT_FIELDS])];
      }
      item.reviewStatus = operation.status; break;
    }
    default: throw new Error('Operación no permitida.');
  }
  if (item && operation.type !== 'status' && !equal(before, item)) {
    touched(item);
    if (['edit', 'assist', 'reset'].includes(operation.type) && !equal(before.product, item.product)) item.copyChecked = false;
  }
  for (const candidate of state.items) { candidate.product.status = 'NEEDS_REVIEW'; candidate.product.needsReview = true; }
  state.revision += 1;
  state.events.push({ type: operation.type, itemNumber: operation.itemNumber, at: new Date().toISOString() });
  reconcile(state);
  return state;
}
export function restoreState(current, incoming) {
  reconcile(incoming);
  assert(incoming.batchId === current.batchId && incoming.mode === current.mode, 'La copia pertenece a otro lote.');
  assert(equal(incoming.sources, current.sources), 'Las fuentes o sus huellas no coinciden.');
  assert(equal(incoming.items.map(i => i.product.itemNumber).sort(), current.items.map(i => i.product.itemNumber).sort()), 'La copia no cubre los números inmutables actuales.');
  const state = clone(incoming);
  state.revision = current.revision + 1;
  // Restoring older edits always needs deliberate reapproval.
  for (const item of active(state)) { item.reviewStatus = 're-review'; item.product.status = 'NEEDS_REVIEW'; item.product.needsReview = true; }
  state.events.push({ type: 'RESTORE', at: new Date().toISOString() });
  return state;
}
