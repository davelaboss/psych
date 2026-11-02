const RETIROS = { month: '', date: '', data: null, request: 0 };
const retirosToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const retiroTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const retiroMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const retiroRange = slot => slot.split('|')[1].split('-').map(retiroMinutes);

function retiroAppointmentCard(item) {
  const phone = String(item.buyerPhone || '');
  const digits = phone.replace(/\D/g, '');
  return `<article class="retiro-appointment${item.needsReschedule ? ' needs-reschedule' : ''}">
    <strong>${adminEscape(item.slotKey.replace('|', ' · '))} · ${adminEscape(item.buyer)}</strong>
    ${item.needsReschedule ? '<strong class="retiro-warning">Necesita reprogramar</strong>' : ''}
    <span>Pedido ${adminEscape(item.orderId)} · Items ${(item.itemNumbers || []).map(n => adminEscape(adminFormatItem(n))).join(', ')}</span>
    <span>Teléfono: ${adminEscape(phone || 'Sin teléfono registrado')}</span>
    <div class="retiro-actions">${digits ? `<a class="secondary-action" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}
    <button class="secondary-action" type="button" data-retiro-order="${adminEscapeAttribute(item.orderId)}">Abrir pedido</button></div>
  </article>`;
}

// Split base hours at every appointment/block boundary, then combine equal adjacent ranges.
function retiroDayRanges(day, blocks, appointments) {
  const ranges = [];
  for (const base of day.ranges) {
    const [from, to] = base.map(retiroMinutes);
    const points = [...new Set([from, to, ...blocks.flatMap(b => [retiroMinutes(b.start), retiroMinutes(b.end)]),
      ...appointments.flatMap(a => retiroRange(a.slotKey))].filter(t => t >= from && t <= to))].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i], end = points[i + 1];
      const blocked = blocks.some(b => retiroMinutes(b.start) < end && retiroMinutes(b.end) > start);
      const remaining = Math.max(0, 4 - appointments.filter(a => {
        const [aStart, aEnd] = retiroRange(a.slotKey); return aStart < end && aEnd > start;
      }).length);
      const label = blocked ? 'Bloqueado' : remaining ? `Disponible · ${remaining} lugar(es)` : 'Completo';
      const previous = ranges.at(-1);
      if (previous?.label === label && previous.end === start) previous.end = end;
      else ranges.push({ start, end, label, blocked });
    }
  }
  return ranges;
}

function renderRetirosTab() {
  RETIROS.date ||= retirosToday(); RETIROS.month ||= RETIROS.date.slice(0, 7);
  const target = document.getElementById('admin-tab-content');
  target.innerHTML = `<section class="admin-content-v2 retiros-shell">
    <div class="admin-section-heading-v2"><div><span class="section-kicker">RETIROS</span><h2>Calendario y disponibilidad</h2>
    <p>Hora de Paraguay · America/Asuncion. Elegí una fecha para ver los turnos o bloquear horarios.</p></div>
    <button type="button" class="secondary-action" data-retiros-refresh>Actualizar</button></div>
    <p data-retiros-status role="status">Cargando calendario…</p>
    <div data-retiros-calendar></div><div data-retiros-day></div>
    <section id="admin-upcoming-pickups"><h2>Próximos retiros</h2><p>Cargando…</p></section>
  </section>`;
  target.querySelector('[data-retiros-refresh]').addEventListener('click', () => loadRetirosMonth());
  void loadRetirosMonth();
  void loadUpcomingPickups();
}

async function loadRetirosMonth() {
  const target = document.querySelector('.retiros-shell'); if (!target) return;
  const request = ++RETIROS.request, month = RETIROS.month;
  const status = target.querySelector('[data-retiros-status]');
  status.textContent = 'Actualizando calendario…';
  try {
    const data = await adminFetch(`/api/admin/pickup-calendar?month=${encodeURIComponent(month)}`);
    if (request !== RETIROS.request || !target.isConnected || ADMIN_STATE.activeTab !== 'retiros') return;
    RETIROS.data = data;
    drawRetirosCalendar(target); drawRetirosDay(target);
    status.textContent = 'Calendario actualizado. Los bloqueos no cambian los turnos existentes.';
  } catch (error) { if (request === RETIROS.request && target.isConnected) status.textContent = error.message; }
}

function drawRetirosCalendar(target) {
  const data = RETIROS.data;
  const monthLabel = new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', month: 'long', year: 'numeric' })
    .format(new Date(`${data.month}-15T12:00:00Z`));
  const offset = (new Date(`${data.month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  target.querySelector('[data-retiros-calendar]').innerHTML = `
    <div class="retiro-month-nav"><button type="button" class="secondary-action" data-retiro-month="-1" aria-label="Mes anterior">←</button>
    <h3>${adminEscape(monthLabel)}</h3><button type="button" class="secondary-action" data-retiro-month="1" aria-label="Mes siguiente">→</button></div>
    <p class="retiro-legend"><span>● Disponible</span><span>T · Turnos</span><span>B · Bloqueos</span></p>
    <div class="retiro-calendar" aria-label="${adminEscapeAttribute(monthLabel)}">
    ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<span class="retiro-weekday">${d}</span>`).join('')}
    ${'<span aria-hidden="true"></span>'.repeat(offset)}
    ${data.days.map(day => {
      const blocks = data.blocks.filter(b => b.date === day.date);
      const appointments = data.appointments.filter(a => a.slotKey.startsWith(`${day.date}|`));
      const available = retiroDayRanges(day, blocks, appointments).some(r => !r.blocked && r.label !== 'Completo');
      const warning = appointments.some(a => a.needsReschedule);
      return `<button type="button" data-retiro-date="${day.date}" aria-pressed="${day.date === RETIROS.date}"
        aria-label="${day.date}: ${available ? 'con disponibilidad' : 'sin disponibilidad'}, ${appointments.length} turnos, ${blocks.length} bloqueos${warning ? ', necesita reprogramar' : ''}"
        class="retiro-date${day.date === RETIROS.date ? ' selected' : ''}">
        <strong>${Number(day.date.slice(-2))}</strong>
        ${available ? '<span class="retiro-available"><i class="retiro-long">Libre</i><i class="retiro-short">●</i></span>' : '<span class="retiro-muted"><i class="retiro-long">Sin horario</i><i class="retiro-short">—</i></span>'}
        ${appointments.length ? `<span class="retiro-booked"><i class="retiro-long">${appointments.length} turno(s)</i><i class="retiro-short">${appointments.length} T</i></span>` : ''}
        ${blocks.length ? `<span class="retiro-blocked"><i class="retiro-long">${blocks.length} bloqueo(s)</i><i class="retiro-short">${blocks.length} B</i></span>` : ''}
        ${warning ? '<span class="retiro-warning"><i class="retiro-long">⚠ Reprogramar</i><i class="retiro-short">⚠</i></span>' : ''}</button>`;
    }).join('')}</div>`;
  target.querySelectorAll('[data-retiro-month]').forEach(button => button.addEventListener('click', () => {
    const next = new Date(`${RETIROS.month}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + Number(button.dataset.retiroMonth));
    RETIROS.month = next.toISOString().slice(0, 7); RETIROS.date = `${RETIROS.month}-01`;
    void loadRetirosMonth();
  }));
  target.querySelectorAll('[data-retiro-date]').forEach(button => button.addEventListener('click', () => {
    RETIROS.date = button.dataset.retiroDate; drawRetirosCalendar(target); drawRetirosDay(target);
    void loadRetirosMonth();
  }));
}

function drawRetirosDay(target) {
  const day = RETIROS.data.days.find(d => d.date === RETIROS.date); if (!day) return;
  const blocks = RETIROS.data.blocks.filter(b => b.date === day.date);
  const appointments = RETIROS.data.appointments.filter(a => a.slotKey.startsWith(`${day.date}|`));
  const ranges = retiroDayRanges(day, blocks, appointments);
  const entries = [
    ...ranges.map(r => ({ start: r.start, type: 2, html: `<li class="retiro-range ${r.blocked ? 'is-blocked' : ''}"><strong>${retiroTime(r.start)}–${retiroTime(r.end)}</strong> ${r.label}</li>` })),
    ...blocks.map(b => ({ start: retiroMinutes(b.start), type: 0, html: `<li class="retiro-block"><strong>${b.start}–${b.end} · Bloqueo del propietario</strong>
      ${b.reason ? `<span>Motivo privado: ${adminEscape(b.reason)}</span>` : ''}
      <button type="button" class="secondary-action" data-retiro-edit="${b.id}">Modificar / quitar</button></li>` })),
    ...appointments.map(a => ({ start: retiroRange(a.slotKey)[0], type: 1, html: `<li>${retiroAppointmentCard(a)}</li>` })),
  ].sort((a, b) => a.start - b.start || a.type - b.type);
  target.querySelector('[data-retiros-day]').innerHTML = `<div class="retiro-daily-layout">
    <section aria-label="Agenda del día"><h3>Agenda · ${day.date}</h3><p>${appointments.length} turno(s). Fuera del horario base no se ofrecen nuevos turnos.</p>
    <ol class="retiro-agenda">${entries.map(e => e.html).join('') || '<li>Sin horarios ni turnos para esta fecha.</li>'}</ol></section>
    <section class="retiro-block-editor"><h3>Bloquear disponibilidad</h3><p>Los turnos existentes se conservan. Revisá los compradores afectados antes de confirmar.</p>
    <form data-retiro-block-form><label>Fecha<input name="date" type="date" value="${day.date}" required></label>
    <label class="retiro-checkbox"><input name="allDay" type="checkbox"> Todo el día</label>
    <div class="retiro-time-fields"><label>Desde<input name="start" type="time" value="08:00" required></label>
    <label>Hasta<input name="end" type="time" value="20:00" required></label></div>
    <label>Motivo privado (opcional)<textarea name="reason" maxlength="500" rows="2"></textarea></label>
    <div class="retiro-actions"><button class="primary-action" type="submit">Revisar bloqueo</button>
    <button class="secondary-action" type="button" data-retiro-new>Nuevo bloqueo</button>
    <button class="secondary-action" type="button" data-retiro-remove hidden>Quitar bloqueo</button></div>
    <p data-retiro-form-error class="form-error" role="alert"></p></form>
    <div data-retiro-review aria-live="polite"></div></section></div>`;
  bindRetirosOrders(target.querySelector('[data-retiros-day]'));
  bindRetirosBlockForm(target);
}

function bindRetirosOrders(root) {
  root.querySelectorAll('[data-retiro-order]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.retiroOrder;
    ADMIN_STATE.activeTab = 'orders'; ADMIN_STATE.orderSearch = id; ADMIN_STATE.orderFilter = 'ALL';
    renderAdminTab(); await refreshAdminOrders(); await openAdminOrder(id);
    document.querySelector(`[data-admin-detail="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));
}

function bindRetirosBlockForm(target) {
  const form = target.querySelector('[data-retiro-block-form]');
  const review = target.querySelector('[data-retiro-review]');
  const error = form.querySelector('[data-retiro-form-error]');
  let editing = null, busy = false;
  const resetReview = () => { review.innerHTML = ''; error.textContent = ''; };
  const toggleTimes = () => {
    for (const name of ['start', 'end']) form.elements[name].disabled = form.elements.allDay.checked;
  };
  form.addEventListener('input', () => { resetReview(); toggleTimes(); });
  const input = () => ({ id: editing?.id, revision: editing?.revision, date: form.elements.date.value,
    allDay: form.elements.allDay.checked, start: form.elements.start.value, end: form.elements.end.value, reason: form.elements.reason.value });
  const send = async body => {
    if (busy) return;
    busy = true; error.textContent = '';
    const controls = [...form.querySelectorAll('button, input, textarea'), ...review.querySelectorAll('button')];
    controls.forEach(c => { c.disabled = true; });
    try {
      const result = await adminFetch('/api/admin/pickup-calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!target.isConnected) return;
      if (result.saved) {
        RETIROS.date = body.date; RETIROS.month = body.date.slice(0, 7);
        await loadRetirosMonth(); await loadUpcomingPickups();
      } else {
        review.innerHTML = `<h4>${result.conflicts.length ? 'Compradores afectados' : 'Sin turnos afectados'}</h4>
          <p>El bloqueo no cancela ni cambia estos turnos. Contactá a cada comprador para reprogramar.</p>
          ${result.conflicts.map(retiroAppointmentCard).join('')}
          <button type="button" class="primary-action" data-retiro-confirm>${result.conflicts.length ? 'Confirmar bloqueo con estos conflictos' : 'Confirmar bloqueo'}</button>`;
        bindRetirosOrders(review);
        review.querySelector('[data-retiro-confirm]').addEventListener('click', () => send({ ...body, action: 'save', reviewToken: result.reviewToken }));
      }
    } catch (problem) { error.textContent = problem.message; }
    finally { busy = false; controls.forEach(c => { c.disabled = false; }); toggleTimes(); }
  };
  form.addEventListener('submit', event => { event.preventDefault(); void send({ ...input(), action: 'preview' }); });
  form.querySelector('[data-retiro-new]').addEventListener('click', () => drawRetirosDay(target));
  target.querySelectorAll('[data-retiro-edit]').forEach(button => button.addEventListener('click', () => {
    editing = RETIROS.data.blocks.find(b => b.id === button.dataset.retiroEdit); resetReview();
    form.elements.date.value = editing.date; form.elements.allDay.checked = editing.start === '00:00' && editing.end === '24:00';
    form.elements.start.value = editing.start;
    form.elements.end.value = editing.end === '24:00' ? '23:59' : editing.end;
    form.elements.reason.value = editing.reason; toggleTimes();
    form.querySelector('[data-retiro-remove]').hidden = false; form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }));
  form.querySelector('[data-retiro-remove]').addEventListener('click', () => {
    resetReview();
    review.innerHTML = '<p>¿Quitar este bloqueo? Los turnos existentes se conservan.</p><button type="button" class="secondary-action" data-retiro-remove-confirm>Confirmar eliminación</button>';
    review.querySelector('button').addEventListener('click', () => send({ ...editing, action: 'remove' }));
  });
}

window.addEventListener('focus', () => {
  if (ADMIN_STATE.activeTab === 'retiros' && !document.querySelector('[data-retiro-block-form]:focus-within')) void loadRetirosMonth();
});
