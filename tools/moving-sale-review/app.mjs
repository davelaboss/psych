import { active, publicPhotos, STATUS_LABELS, approvalErrors } from './core.mjs';
const $ = id => document.getElementById(id);
let state, token, selectedId, gallery = [], photoIndex = 0, dirty = false, busy = false, formDirty = false;
const pendingQuestions = new Map();
let pendingResearch = null;
const fields = [
  ['title', 'Nombre del producto'], ['category', 'Categoría'], ['asking', 'Precio actual del vendedor (Gs.)'], ['quantityTotal', 'Cantidad disponible', 'number'],
  ['description', 'Descripción pública', 'area'], ['condition', 'Condición'], ['knownDefects', 'Defectos conocidos', 'area'],
  ['functionality', 'Funcionamiento', ['Sin confirmar', 'Funciona muy bien', 'Funciona bien', 'Funciona parcialmente', 'No funciona', 'Falta probar', 'No aplica']],
  ['measurements', 'Medidas (ej.: 80 alto × 45 ancho × 40 prof; MEDIR solo interno)'],
  ['saleMode', 'Modalidad de retiro', [['IMMEDIATE', 'Inmediato'], ['DELAYED', 'Diciembre: pago 1–8; retiro 9–12']]],
  ['saleStructure', 'Estructura de venta', [['undecided', 'Falta decidir'], ['individual', 'Por unidad'], ['set', 'Juego completo'], ['flexible', 'Por separado o junto']]],
  ['includedAccessories', 'INCLUIDO CON LA VENTA (una cosa por línea)', 'area'], ['notIncludedVisible', 'NO INCLUIDO CON LA VENTA', 'area'],
  ['requiresVehicle', 'Requiere vehículo', [['false', 'No'], ['true', 'Sí']]], ['requiresLoadingHelp', 'Requiere ayuda para cargar', [['false', 'No'], ['true', 'Sí']]],
  ['ownerNotes', 'Notas del propietario (internas)', 'area'], ['pricingDecision', 'Decisión de precio (interna)', 'area'],
];
const labels = { originalPricePaid: 'Precio original pagado', currentRetailPrice: 'Precio actual nuevo', localUsedMarketRange: 'Rango local usado', suggestedAskingPrice: 'Precio sugerido', fastSalePrice: 'Referencia de venta rápida', privateSellerFloor: 'Mínimo privado', confidence: 'Confianza', rationale: 'Fundamento', uncertainties: 'Incertidumbres', sources: 'Fuentes', comparables: 'Comparables' };
function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function money(value) { return value == null ? 'Sin precio' : `Gs. ${Number(value).toLocaleString('es-PY')}`; }
function current() { return active(state).find(i => i.product.itemNumber === selectedId); }
function notify(message) { $('message').textContent = message; if ($('save-message')) $('save-message').textContent = message; }
async function action(operation, endpoint = '/api/action', extra = {}) {
  if (busy) return false;
  busy = true;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-review-token': token }, body: JSON.stringify({ operation, revision: state.revision, ...extra }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    state = result.state; dirty = false; notify(result.message || 'Guardado en disco.'); renderCards(); return true;
  } catch (error) { notify(error.message); alert(error.message); return false; }
  finally { busy = false; }
}
function renderCards() {
  const query = $('search').value.trim().toLocaleLowerCase('es'), filter = $('filter').value;
  $('cards').replaceChildren(); $('empty').hidden = active(state).length !== 0;
  $('workbook').disabled = active(state).length === 0;
  $('handoff').disabled = state.mode !== 'real' || active(state).length === 0;
  document.querySelector('a[href="Moving_Sale_Inventory_Volume_5.xlsx"]').hidden = active(state).length === 0;
  for (const item of active(state)) {
    const p = item.product;
    if (query && !`${p.itemNumber} ${p.title}`.toLocaleLowerCase('es').includes(query)) continue;
    if (filter !== 'all' && !(filter === 'edited' ? item.edited : filter === item.reviewStatus)) continue;
    const card = element('article', undefined, 'card');
    const cover = item.photos.find(ph => ph.sourceId === item.coverSourceId) || publicPhotos(item)[0];
    if (cover) { const img = element('img'); img.src = cover.path; img.alt = p.title; img.loading = 'lazy'; card.append(img); }
    const content = element('div', undefined, 'card-content');
    content.append(element('small', `ITEM ${p.itemNumber}`), element('h2', p.title), element('b', money(p.asking)), element('p', STATUS_LABELS[item.reviewStatus], `badge ${item.reviewStatus}`));
    content.append(element('p', `${item.edited ? '✎ Editado · ' : ''}${approvalErrors(item).length ? '⚠ Faltan datos' : 'Datos completos'}`));
    const button = element('button', 'Revisar producto'); button.onclick = () => openItem(p.itemNumber); content.append(button); card.append(content); $('cards').append(card);
  }
}
function control(key, label, kind, value) {
  const wrapper = element('label', label); if (kind === 'area') wrapper.className = 'wide';
  let input;
  if (Array.isArray(kind)) {
    input = element('select');
    const choices = kind.map(v => Array.isArray(v) ? v : [v === 'Sin confirmar' ? '' : v, v]);
    if (!choices.some(([v]) => String(v) === String(value))) choices.unshift([String(value ?? ''), String(value || 'Sin confirmar')]);
    for (const [v, text] of choices) { const option = element('option', text); option.value = v; input.append(option); }
  } else { input = element(kind === 'area' ? 'textarea' : 'input'); if (kind === 'number') input.type = 'number'; }
  input.name = key; input.value = Array.isArray(value) ? value.join('\n') : value ?? ''; input.oninput = () => { dirty = true; formDirty = true; }; wrapper.append(input); return wrapper;
}
async function save() {
  if (!dirty) return true;
  const questionEdits = [...pendingQuestions.entries()], researchEdit = pendingResearch;
  let parsedResearch;
  try { if (researchEdit !== null) parsedResearch = JSON.parse(researchEdit); } catch { alert('La investigación no contiene JSON válido. Guarde o corrija la evidencia antes de continuar.'); return false; }
  const changes = {};
  for (const [key, , kind] of fields) {
    let value = $('edit').elements.namedItem(key).value.trim();
    if (!value) continue;
    if (key === 'includedAccessories' && value !== 'REMOVE') value = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    else if (kind === 'number' && value !== 'REMOVE') value = Number(value);
    else if (['requiresVehicle', 'requiresLoadingHelp'].includes(key)) value = value === 'true';
    changes[key] = value;
  }
  if (formDirty) { if (!await action({ type: 'edit', itemNumber: selectedId, changes })) return false; formDirty = false; }
  for (const [questionId, answer] of questionEdits) {
    if (!await action({ type: 'question', itemNumber: selectedId, questionId, answer })) { dirty = true; return false; }
    pendingQuestions.delete(questionId);
  }
  if (researchEdit !== null) {
    if (!await action({ type: 'research', itemNumber: selectedId, pricing: parsedResearch })) { dirty = true; return false; }
    pendingResearch = null;
  }
  dirty = false; return true;
}
async function leave() { return !dirty || confirm('Hay cambios sin guardar. ¿Guardarlos antes de continuar?') && await save(); }
function selectedSources() { return [...$('detail').querySelectorAll('input[data-source]:checked')].map(e => e.dataset.source); }
async function operate(operation) { if (await leave() && await action({ itemNumber: selectedId, ...operation })) { const item = current(); if (item) renderDetail(); else $('detail').close(); } }
function photoCard(photo, item, reference = false) {
  const box = element('div', undefined, 'photo-card'), img = element('img'); img.src = photo.path; img.alt = `Foto ${photo.sourceId}`; img.onclick = () => showPhoto(photo.sourceId);
  const selected = element('input'); selected.type = 'checkbox'; selected.dataset.source = photo.sourceId;
  const label = element('label', 'Seleccionar foto'); label.prepend(selected);
  box.append(img, element('span', item.coverSourceId === photo.sourceId ? 'FOTO PRINCIPAL' : '', 'cover-label'), label);
  const actions = element('div', undefined, 'actions');
  if (!reference) {
    const cover = element('button', 'Elegir como principal'); cover.onclick = () => operate({ type: 'cover', sourceId: photo.sourceId }); actions.append(cover);
    for (const [offset, title] of [[-1, '← Antes'], [1, 'Después →']]) {
      const move = element('button', title); move.onclick = () => { const ids = publicPhotos(item).map(p => p.sourceId), i = ids.indexOf(photo.sourceId), j = i + offset; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; operate({ type: 'order', sourceIds: ids }); }; actions.append(move);
    }
  }
  const role = element('button', reference ? 'Volver a fotos públicas' : 'Solo referencia');
  role.onclick = () => { const justification = reference ? '' : prompt('Explique la instrucción del propietario o la justificación para excluir esta foto del público:'); if (!reference && !justification?.trim()) return; operate({ type: 'role', sourceId: photo.sourceId, role: reference ? 'public' : 'reference', justification }); }; actions.append(role);
  box.append(actions); if (reference) box.append(element('p', photo.justification)); return box;
}
function renderDetail() {
  const item = current(); if (!item) return;
  $('heading').textContent = `ITEM ${item.product.itemNumber} · ${item.product.title}`; $('status').textContent = STATUS_LABELS[item.reviewStatus]; $('status').className = `badge ${item.reviewStatus}`;
  $('warnings').textContent = approvalErrors(item).join('\n');
  $('fields').replaceChildren(...fields.map(([key, label, kind]) => control(key, label, kind, key in item.product ? item.product[key] : item[key])));
  $('photos').replaceChildren(...publicPhotos(item).map(photo => photoCard(photo, item)));
  $('references').replaceChildren(...item.photos.filter(p => p.role === 'reference').map(photo => photoCard(photo, item, true)));
  $('grouping').checked = item.groupingConfirmed; $('copy-check').checked = item.copyChecked;
  $('target').replaceChildren(); for (const other of active(state).filter(i => i !== item)) { const option = element('option', `Item ${other.product.itemNumber} · ${other.product.title}`); option.value = other.product.itemNumber; $('target').append(option); }
  $('questions').replaceChildren();
  for (const question of item.questions) {
    const block = element('div'), label = control(question.id, `${question.resolved ? '✓ ' : ''}${question.text}`, 'area', question.answer), button = element('button', 'Guardar respuesta');
    label.querySelector('textarea').oninput = event => { pendingQuestions.set(question.id, event.target.value); dirty = true; };
    button.onclick = async () => { if (await save()) renderDetail(); }; block.append(label, button); $('questions').append(block);
  }
  $('pricing').replaceChildren(element('dt', 'Precio actual del vendedor'), element('dd', money(item.product.asking)));
  for (const [key, label] of Object.entries(labels)) {
    const value = item.pricing[key]; const display = key === 'confidence' ? ({ LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' })[value] : typeof value === 'number' ? money(value) : Array.isArray(value) ? value.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join('\n') : value;
    $('pricing').append(element('dt', label), element('dd', display || (key === 'suggestedAskingPrice' ? 'Falta investigación de precio' : 'Sin datos')));
  }
  $('research').value = JSON.stringify(item.pricing, null, 2); dirty = false; formDirty = false; pendingQuestions.clear(); pendingResearch = null;
}
async function openItem(id) { if (!await leave()) return; selectedId = id; renderDetail(); $('detail').showModal(); }
async function navigate(offset) { if (!await leave()) return; const list = active(state), index = list.findIndex(i => i.product.itemNumber === selectedId); selectedId = list[(index + offset + list.length) % list.length].product.itemNumber; renderDetail(); }
function showPhoto(sourceId) { gallery = current().photos; photoIndex = gallery.findIndex(p => p.sourceId === sourceId); renderViewer(); $('viewer').showModal(); }
function renderViewer() { $('full-photo').src = gallery[photoIndex].path; $('photo-position').textContent = `Foto ${photoIndex + 1} de ${gallery.length}`; $('previous-photo').disabled = photoIndex === 0; $('next-photo').disabled = photoIndex === gallery.length - 1; }
function movePhoto(offset) { const next = photoIndex + offset; if (next < 0 || next >= gallery.length) return; photoIndex = next; renderViewer(); }
$('edit').onsubmit = async event => { event.preventDefault(); if (await save()) renderDetail(); };
$('close').onclick = async () => { if (await leave()) $('detail').close(); };
$('previous').onclick = () => navigate(-1); $('next').onclick = () => navigate(1);
for (const [id, status] of [['approve', 'approved'], ['missing', 'missing'], ['unreviewed', 'unreviewed']]) $(id).onclick = () => operate({ type: 'status', status });
$('grouping').onchange = () => operate({ type: 'grouping', confirmed: $('grouping').checked });
$('copy-check').onchange = () => operate({ type: 'copy-check', confirmed: $('copy-check').checked });
$('reset').onclick = () => { if (confirm('¿Restablecer las propuestas sin borrar los datos confirmados?')) operate({ type: 'reset', confirm: 'RESTABLECER' }); };
$('split').onclick = () => operate({ type: 'split', sourceIds: selectedSources() });
$('transfer').onclick = () => operate({ type: 'transfer', sourceIds: selectedSources(), targetItemNumber: $('target').value });
$('merge').onclick = () => { if (confirm('¿Transferir y verificar todas las fotos antes de retirar este Item? El número retirado nunca se reutilizará.')) operate({ type: 'merge', targetItemNumber: $('target').value }); };
$('research').oninput = () => { pendingResearch = $('research').value; dirty = true; };
$('save-research').onclick = async () => { if (await save()) renderDetail(); };
$('search').oninput = renderCards; $('filter').onchange = renderCards;
$('workbook').onclick = async () => { if (await leave()) await action(null, '/api/workbook'); };
$('handoff').onclick = async () => { if (await leave()) await action(null, '/api/handoff'); };
$('restore').onchange = async event => { const file = event.target.files[0]; if (!file) return; if (!await leave() || !confirm('Se guardará una copia del estado actual. La revisión restaurada requerirá nueva aprobación. ¿Continuar?')) return; try { await action(null, '/api/restore', { state: JSON.parse(await file.text()) }); } catch (error) { alert(error.message); } event.target.value = ''; };
$('close-viewer').onclick = () => $('viewer').close(); $('previous-photo').onclick = () => movePhoto(-1); $('next-photo').onclick = () => movePhoto(1);
$('detail').addEventListener('cancel', event => { event.preventDefault(); $('close').click(); });
document.addEventListener('keydown', event => { if ($('viewer').open) { if (event.key === 'ArrowLeft') { event.preventDefault(); movePhoto(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); movePhoto(1); } return; } if (!$('detail').open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return; if (event.key === 'ArrowLeft') navigate(-1); if (event.key === 'ArrowRight') navigate(1); });
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
try { const result = await (await fetch('/api/state')).json(); state = result.state; token = result.token; renderCards(); notify(`Revisión ${state.revision} cargada desde disco.${state.mode === 'fixture' ? ' ENSAYO: no usa números reales de Item.' : ''}`); } catch (error) { notify(`No se pudo abrir la revisión: ${error.message}. Inicie el servidor local con el comando documentado.`); }
