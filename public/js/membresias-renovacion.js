window.MembresiasRenovacion = (() => {
  function init(options) {
    const root = document.getElementById('modal-renovar');
    if (!document.querySelector('link[href="/css/membresias.css"]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/membresias.css';
      document.head.append(css);
    }
    const el = name => root.querySelector(`#renovar-${name}`);
    let membership, planes = [], sequence = 0, busy = false, startDate, trigger, historySequence = 0;
    const active = () => root.isConnected && !window.__spaPageAbort?.signal.aborted;
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const dateInput = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
    const plan = () => planes.find(p => String(p._id || p.id) === el('plan').value);
    const money = n => Math.round(Number(n) * 100) / 100;
    function error(message) {
      el('error').textContent = message;
      el('error').classList.remove('hidden');
      el('error').focus();
    }
    function refresh() {
      const selected = plan();
      const price = Number(el('precio').value);
      const partial = el('estado-pago').value === 'abono';
      el('abono-group').classList.toggle('hidden', !partial);
      el('abono').required = partial;
      el('abono').disabled = !partial;
      el('abono').max = String(price);
      el('metodo').disabled = el('estado-pago').value === 'pendiente';
      el('precio-base').textContent = selected ? `Precio de catálogo: ${fmtMoney(selected.precio)}` : '';
      const beginning = el('inicio').readOnly ? startDate : `${el('inicio').value}T05:00:00.000Z`;
      const end = new Date(new Date(beginning).getTime() + Number(selected?.duracion_dias || 0) * 86400000);
      el('fin').value = Number.isFinite(+end) ? dateInput(end) : '';
      const paid = el('estado-pago').value === 'pendiente' ? 0 : partial ? Number(el('abono').value || 0) : price;
      el('monto-final').textContent = `Nuevo periodo: ${selected?.duracion_dias || 0} días. Total: ${fmtMoney(price || 0)}. Abonado: ${fmtMoney(paid || 0)}. Saldo: ${fmtMoney(Math.max(0, price - paid))}.`;
    }
    function resetPrice() {
      el('precio').value = String(plan()?.precio || 0);
      el('descuento').value = '0';
      refresh();
    }
    el('plan').onchange = resetPrice;
    el('precio').oninput = () => {
      el('descuento').value = String(money(Math.max(0, (plan()?.precio || 0) - Number(el('precio').value))));
      refresh();
    };
    el('descuento').oninput = () => {
      el('precio').value = String(money(Math.max(0, (plan()?.precio || 0) - Number(el('descuento').value))));
      refresh();
    };
    el('restaurar').onclick = resetPrice;
    ['inicio', 'estado-pago', 'abono'].forEach(name => { el(name).oninput = refresh; });
    document.getElementById('btn-close-periodos').onclick = () => closeModal('modal-periodos');
    function close() {
      closeModal('modal-renovar');
      if (trigger?.isConnected) trigger.focus();
    }
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const controls = [...root.querySelectorAll('button,input:not([type=hidden]),select,textarea,[tabindex="-1"]')]
        .filter(control => !control.disabled && control.getClientRects().length && control.tabIndex >= 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }, window.__spaPageAbort ? { signal: window.__spaPageAbort.signal } : undefined);

    async function open(memId) {
      if (busy) return;
      trigger = document.activeElement;
      const request = ++sequence;
      try {
        const [fresh, available, caja] = await Promise.all([api.get(`/membresias/${memId}/detalle`, true),
          api.get('/planes', true), api.get('/caja/estado', true)]);
        if (!active() || request !== sequence) return;
        if (!caja) { toast('Abre la caja antes de renovar.', 'warning'); return; }
        if (fresh.saldo_total > 0) { toast('Debe cancelar primero la deuda anterior en Pagos.', 'warning'); return; }
        if (fresh.proxima_renovacion) { toast('Ya hay una renovación programada.', 'info'); return; }
        membership = fresh;
        planes = available.filter(p => p.activo !== false);
        options.setCaja(caja);
        el('plan').replaceChildren(...planes.map(p => new Option(`${p.nombre} — ${fmtMoney(p.precio)} (${p.duracion_dias} días)`, p._id || p.id)));
        el('plan').value = fresh.plan_actual_id;
        if (!el('plan').value && planes.length) el('plan').selectedIndex = 0;
        el('mem-id').value = memId;
        el('error').classList.add('hidden');
        el('info').textContent = `${fresh.cliente_nombre} · Plan anterior: ${fresh.plan_nombre} · Precio anterior: ${fmtMoney(fresh.precio)} · Vencimiento: ${fmtDate(fresh.fecha_fin)}`;
        const advance = new Date(fresh.fecha_fin) > new Date();
        startDate = fresh.fecha_fin;
        el('inicio').value = advance ? dateInput(fresh.fecha_fin) : today();
        el('inicio').readOnly = advance;
        el('inicio').min = advance ? el('inicio').value : today();
        el('fecha-ayuda').textContent = advance ? 'Comienza al vencer el periodo actual; conservas tus días disponibles.' : 'Desde hoy. Puedes elegir una fecha posterior.';
        el('estado-pago').value = 'pagado'; el('metodo').value = 'efectivo';
        el('notas').value = ''; el('abono').value = '';
        resetPrice();
        openModal('modal-renovar'); el('plan').focus();
      } catch (err) { if (active()) toast(err.message, 'error'); }
    }

    async function save() {
      if (busy || !membership) return;
      el('error').classList.add('hidden');
      const fields = [...root.querySelectorAll('input:not([type=hidden]),select,textarea')];
      const invalid = fields.find(field => !field.checkValidity());
      if (invalid) { invalid.reportValidity(); return; }
      const type = el('estado-pago').value;
      const price = money(el('precio').value);
      const monto = type === 'abono' ? money(el('abono').value) : undefined;
      if (type === 'abono' && (!monto || monto > price)) { error('El abono debe ser mayor a cero y no superar el precio acordado.'); return; }
      busy = true;
      try {
        await api.post(`/membresias/${membership.id}/renovar`, {
          version: membership.version, plan_id: el('plan').value, precio_acordado: price,
          fecha_inicio: el('inicio').readOnly ? startDate : el('inicio').value,
          monto, estado_pago: type === 'pendiente' ? 'pendiente' : 'pagado',
          metodo_pago: el('metodo').value, notas: el('notas').value || null,
          caja_id: options.getCaja()._id || options.getCaja().id,
        }, false, { invalidate: ['membresias', 'pagos', 'clientes', 'caja', 'dashboard', 'reports', 'asistencia'] });
        if (!active()) return;
        close(); toast('Renovación registrada. Se conservó la misma membresía.');
        await options.reload();
      } catch (err) { if (active()) error(err.message); }
      finally { busy = false; }
    }

    async function history(memId) {
      const request = ++historySequence;
      const list = document.getElementById('periodos-lista');
      list.textContent = 'Cargando historial…'; openModal('modal-periodos');
      try {
        const mem = await api.get(`/membresias/${memId}/detalle`, true);
        if (!active() || request !== historySequence) return;
        list.replaceChildren();
        const periods = mem.periodos?.length ? mem.periodos : [{ plan_nombre: mem.plan_nombre,
          fecha_inicio: mem.fecha_inicio, fecha_fin: mem.fecha_fin, monto_total: mem.precio, inicial: true }];
        for (const p of [...periods].reverse()) {
          const article = document.createElement('article');
          const title = document.createElement('strong'); title.textContent = `${p.inicial ? 'Alta' : 'Renovación'} · ${p.plan_nombre}`;
          const dates = document.createElement('p'); dates.textContent = `${fmtDate(p.fecha_inicio)} — ${fmtDate(p.fecha_fin)}`;
          const amount = document.createElement('p'); amount.textContent = `Precio acordado: ${fmtMoney(p.monto_total)}${p.precio_base != null ? ` · Catálogo: ${fmtMoney(p.precio_base)}` : ''}${p.descuento != null ? ` · Descuento: ${fmtMoney(p.descuento)}` : ''}`;
          const note = document.createElement('p'); note.textContent = p.notas || '';
          article.append(title, dates, amount, note); list.append(article);
        }
      } catch (err) { if (active()) list.textContent = err.message; }
    }
    return { open, save, history, close };
  }
  return { init };
})();
