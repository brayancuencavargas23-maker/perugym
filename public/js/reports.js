window.initReports = function () {
  const root = document.getElementById('reports-root');
  const $ = id => root.querySelector('#' + id);
  const signal = window.__spaPageAbort?.signal;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n);
  const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const localDate = v => v ? new Date(v).toLocaleDateString('es-PE', { timeZone: 'America/Lima' }) : 'Sin visitas';
  const active = () => root.isConnected && !signal?.aborted;
  let data, appliedQuery, view = 'daily', page = 1, request = 0, charts = [];
  const listen = (el, event, handler) => el.addEventListener(event, handler, signal ? { signal } : undefined);
  const destroy = () => { charts.forEach(c => c.destroy()); charts = []; };
  signal?.addEventListener('abort', destroy, { once: true });
  function preset() {
    const now = new Date(), today = day(now), start = new Date(`${today}T12:00:00-05:00`);
    let from = today, to = today;
    switch ($('rep-preset').value) {
      case 'month': from = `${today.slice(0, 7)}-01`; break;
      case 'week': from = day(new Date(+start - 6 * 86400000)); break;
      case 'previous': { const first = new Date(`${today.slice(0, 7)}-01T12:00:00-05:00`); to = day(new Date(+first - 86400000)); from = `${to.slice(0, 7)}-01`; break; }
      case 'custom': return;
    }
    $('rep-from').value = from; $('rep-to').value = to;
  }
  function query() {
    const from = $('rep-from').value, to = $('rep-to').value;
    if (!from || !to || from > to) throw new Error('Selecciona un rango de fechas válido.');
    if (to > day(new Date())) throw new Error('Selecciona fechas hasta hoy.');
    if ((new Date(to) - new Date(from)) / 86400000 >= 366) throw new Error('El rango máximo es de 366 días.');
    return new URLSearchParams({ from, to, inactiveDays: $('rep-inactive').value }).toString();
  }
  function selectView(next) {
    view = next; page = 1; $('rep-search').value = '';
    root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    renderTable();
  }
  function table(headers, rows) { return `<table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
  function render() {
    const s = data.stats;
    const kpis = [
      ['Ingresos cobrados', money(s.ingresos), s.variacion === null ? 'Sin base de comparación' : `${s.variacion > 0 ? '+' : ''}${s.variacion}% vs. período anterior`, 'daily'],
      ['Clientes vigentes hoy', s.activos, 'Personas únicas con membresía vigente', 'activeClients'],
      ['Nuevos clientes de pago', s.nuevos, 'Primera contratación pagada en el período', 'newClients'],
      ['Renovación en 7 días', s.renovacion === null ? 'Sin base' : `${s.renovacion}%`, `${s.renovados} de ${s.elegibles} oportunidades evaluadas`, 'renewals'],
      ['Saldo actual por cobrar', money(s.saldo), `${s.deudores} clientes · incluye abonos`, 'debts'],
      ['Sin asistencia reciente', s.inactivos, 'Membresías vigentes · umbral aplicado', 'inactiveClients']
    ];
    $('rep-kpis').innerHTML = kpis.map(([label, value, note, target]) => `<button class="rep-kpi" data-open="${target}"><span>${esc(label)}</span><strong>${esc(value)}</strong><span class="rep-muted">${esc(note)}</span></button>`).join('');
    $('rep-context').textContent = `Período: ${data.periodo.from} al ${data.periodo.to} · Comparación: ${data.periodo.previousFrom} al ${data.periodo.previousTo} (${data.periodo.days} días). Vigentes, saldos, stock y seguimientos son actuales.`;
    $('rep-income-caption').textContent = `${money(s.ingresos)} cobrados frente a ${money(s.anterior)}. Zona horaria: Lima.`;
    const pending = data.recommendations.filter(r => r.seguimiento.estado !== 'resuelto');
    $('rep-insights').innerHTML = `<div class="rep-notice"><strong>${pending.length} seguimientos abiertos</strong><p class="rep-muted">Vencimientos, saldos y ausencia de visitas. Cada fila explica el motivo.</p><button class="btn btn-outline" data-open="recommendations">Ver y gestionar</button></div>` +
      (data.incomeAlert ? `<div class="rep-notice"><strong>Ingresos ${Math.abs(s.variacion)}% por debajo</strong><p class="rep-muted">Comparación de períodos consecutivos de igual duración. Revisa el origen de la diferencia.</p><button class="btn btn-outline" data-open="daily">Revisar ingresos</button></div>` : '') +
      `<div class="rep-notice"><strong>${data.stockAlerts.length} productos para revisar</strong><p class="rep-muted">Sin stock o cobertura estimada de hasta 7 días según ventas del período. Es una estimación, no una orden de compra.</p><button class="btn btn-outline" data-open="products">Ver productos</button></div>`;
    const labels = { membresias: 'Membresías', productos: 'Productos', rutinas: 'Rutinas', otros: 'Otros ingresos' };
    const methodLabels = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia' };
    const methodOrder = ['efectivo', 'yape', 'plin', 'transferencia'];
    const methods = Object.entries(data.methods || {}).sort((a, b) => {
      const ia = methodOrder.indexOf(a[0]), ib = methodOrder.indexOf(b[0]);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return b[1] - a[1];
    });
    const methodsTotal = methods.reduce((sum, [, n]) => sum + n, 0);
    const methodsTable = methodsTotal
      ? table(['Método de pago', 'Cobrado', '%'], methods.map(([k, n]) => [methodLabels[k] || k, money(n), `${(n / methodsTotal * 100).toFixed(1)}%`]))
      : '<p class="rep-muted">Sin cobros en el período.</p>';
    $('rep-sources').innerHTML = table(['Origen', 'Cobrado'], Object.entries(data.sources).map(([k, n]) => [labels[k], money(n)])) +
      `<h3 style="margin-top:20px">Método de pago</h3>${methodsTable}` +
      `<p class="rep-muted">Egresos registrados: ${money(s.egresos)}. Los ingresos no equivalen a utilidad.</p>`;
    $('rep-plans').innerHTML = data.plans.length ? table(['Plan', 'Contrataciones'], data.plans.sort((a,b) => b.cantidad-a.cantidad).map(p => [p.nombre, p.cantidad])) : '<p class="rep-muted">Sin contrataciones en el período.</p>';
    $('rep-attendance-caption').textContent = `${s.visitas} entradas · ${s.visitantes} clientes únicos. Afluencia de entrada, no ocupación simultánea. Cada celda muestra el número de entradas.`;
    const max = Math.max(1, ...data.heatmap.flat());
    $('rep-heatmap').innerHTML = `<table class="rep-heat"><caption>Hora local de Lima · intensidad relativa de entradas</caption><thead><tr><th scope="col">Día</th>${Array.from({length:24}, (_, h) => `<th scope="col">${h}h</th>`).join('')}</tr></thead><tbody>${data.heatmap.map((hours, d) => `<tr><th scope="row">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'][d]}</th>${hours.map((n,h) => `<td title="${h}:00 — ${n} entradas" style="background:rgba(180,83,9,${n ? .08 + .25*n/max : 0})">${n}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    renderTable();
  }
  function renderTable() {
    if (!data) return;
    const specs = {
      activeClients: { headers: ['Cliente', 'Plan', 'Inicio', 'Vencimiento'], rows: data.activeClients, cells: r => [r.nombre, r.plan, localDate(r.inicio), localDate(r.fin)], note: 'Clientes únicos con una membresía activa dentro de sus fechas de vigencia, a la fecha de actualización.' },
      newClients: { headers: ['Cliente', 'Primer pago'], rows: data.newClients, cells: r => [r.nombre, localDate(r.fecha)], note: 'Clientes cuyo primer pago confirmado asociado a una membresía ocurrió en el período.' },
      inactiveClients: { headers: ['Cliente', 'Plan', 'Última visita', 'Días sin asistencia'], rows: data.inactiveClients, cells: r => [r.nombre, r.plan, localDate(r.fecha), r.dias], note: 'Solo membresías vigentes. El plazo comienza en la última visita o el inicio de la membresía, el más reciente. Gestiona el contacto desde Seguimientos.' },
      daily: { headers: ['Fecha', 'Cobrado', 'Fecha comparable', 'Anterior', 'Altas', 'Posteriores'], rows: data.daily, cells: r => [r.fecha, money(r.actual), r.anteriorFecha, money(r.anterior), r.altas, r.renovaciones], note: 'Importes cobrados. Altas y posteriores representan inicios de membresías, no cantidad de pagos.' },
      debts: { headers: ['Cliente', 'Plan', 'Acordado', 'Pagado', 'Saldo'], rows: data.debts, cells: r => [r.nombre, r.plan, money(r.acordado), money(r.pagado), money(r.saldo)], note: 'Saldo actual por membresía no cancelada. Se usa el importe acordado o los importes históricos registrados; nunca el precio actual del plan.' },
      renewals: { headers: ['Cliente', 'Plan', 'Vencimiento', 'Resultado'], rows: data.renewals, cells: r => [r.nombre, r.plan, localDate(r.fecha), r.resultado], note: 'Una oportunidad por cliente: último vencimiento del período cuya ventana de 7 días ya terminó. Renovó si inició otra membresía no pendiente dentro de esa ventana.' },
      products: { headers: ['Producto', 'Stock actual', 'Unidades vendidas', 'Ingresos', 'Cobertura estimada'], rows: data.products, cells: r => [r.nombre, r.stock, r.unidades, money(r.ingresos), r.diasStock === null ? 'Sin ventas para estimar' : `${r.diasStock} días`], note: 'Productos activos. Ventas del período seleccionado; stock actual. Cobertura = stock / promedio diario de unidades vendidas.' },
      recommendations: { headers: ['Cliente', 'Motivo y acción', 'Contacto', 'Seguimiento'], rows: data.recommendations, cells: r => [r.nombre, `${r.motivo} ${r.accion}`], note: 'Señales actuales para seguimiento, no predicciones de abandono. Resolver un seguimiento no modifica deudas ni membresías.' }
    };
    const spec = specs[view], term = $('rep-search').value.toLocaleLowerCase();
    let rows = spec.rows.filter(r => spec.cells(r).join(' ').toLocaleLowerCase().includes(term));
    if (view === 'recommendations' && $('rep-follow-state').value) rows = rows.filter(r => r.seguimiento.estado === $('rep-follow-state').value);
    const pages = Math.max(1, Math.ceil(rows.length / 15)); page = Math.max(1, Math.min(page, pages));
    $('rep-follow-filter').hidden = view !== 'recommendations';
    $('rep-detail-note').textContent = spec.note;
    $('rep-head').innerHTML = `<tr>${spec.headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr>`;
    $('rep-body').innerHTML = rows.slice((page-1)*15, page*15).map(r => {
      let cells = spec.cells(r).map(c => `<td>${esc(c)}</td>`).join('');
      if (view === 'recommendations') {
        let phone = String(r.telefono || '').replace(/\D/g, ''); if (phone.length === 9) phone = '51' + phone;
        const contact = /^\d{10,15}$/.test(phone) ? `<a class="btn btn-outline" href="https://wa.me/${phone}?text=${encodeURIComponent(`Hola ${r.nombre}, te contactamos de PeruGym para hacer seguimiento a tu membresía.`)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : 'Sin teléfono válido';
        cells += `<td>${contact}</td><td><div class="rep-follow"><select class="form-control" aria-label="Seguimiento de ${esc(r.nombre)}" data-track="${esc(r.clave)}">${['pendiente','contactado','resuelto'].map(s => `<option value="${s}" ${r.seguimiento.estado === s ? 'selected' : ''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select><small>${esc(r.seguimiento.responsable || 'Sin gestionar')}${r.seguimiento.actualizado ? ' · ' + esc(localDate(r.seguimiento.actualizado)) : ''}</small><a href="${r.tipo === 'saldo' ? '/pagos.html' : '/membresias.html'}">Abrir ${r.tipo === 'saldo' ? 'Pagos' : 'Membresías'}</a></div></td>`;
      }
      return `<tr>${cells}</tr>`;
    }).join('') || `<tr><td colspan="${spec.headers.length}">Sin resultados para esta vista.</td></tr>`;
    $('rep-page').textContent = `${rows.length} registros · Página ${page} de ${pages}`;
    $('rep-prev').disabled = page === 1; $('rep-next').disabled = page === pages;
  }
  async function loadChartLibrary() {
    if (window.Chart) return;
    if (!window.__reportsChartLoading) window.__reportsChartLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
      script.onload = resolve; script.onerror = () => { script.remove(); window.__reportsChartLoading = null; reject(new Error('No se pudo cargar la librería de gráficos. Los datos están disponibles en las tablas.')); };
      document.head.appendChild(script);
    });
    await window.__reportsChartLoading;
  }
  async function renderCharts() {
    try {
      await loadChartLibrary(); if (!active() || !data) return;
      destroy();
      const color = getComputedStyle(root).getPropertyValue('--text').trim() || '#475569';
      const options = { responsive:true, maintainAspectRatio:false, animation: !matchMedia('(prefers-reduced-motion: reduce)').matches,
        plugins:{legend:{labels:{color}}}, scales:{x:{ticks:{color,maxTicksLimit:10},grid:{display:false}},y:{beginAtZero:true,ticks:{color}}} };
      const comparison = $('rep-compare').checked ? [{label:'Período anterior',data:data.daily.map(d=>d.anterior),borderColor:'#64748b',borderDash:[5,5],pointRadius:0}] : [];
      charts.push(new Chart($('rep-income'), {type:'line',data:{labels:data.daily.map(d=>d.fecha),datasets:[{label:'Cobrado (S/)',data:data.daily.map(d=>d.actual),borderColor:'#b45309',pointRadius:data.daily.length > 31 ? 0 : 2},...comparison]},options}));
      charts.push(new Chart($('rep-memberships'), {type:'bar',data:{labels:data.daily.map(d=>d.fecha),datasets:[{label:'Altas',data:data.daily.map(d=>d.altas),backgroundColor:'#0f766e'},{label:'Posteriores',data:data.daily.map(d=>d.renovaciones),backgroundColor:'#b45309'}]},options}));
    } catch (err) { if (active()) $('rep-status').textContent = err.message; }
  }
  async function load() {
    let q; try { q = query(); } catch (err) { $('rep-status').textContent = err.message; return; }
    const ticket = ++request;
    $('rep-status').classList.remove('rep-error'); $('rep-status').textContent = 'Calculando indicadores y recomendaciones…';
    $('rep-results').hidden = true; $('rep-excel').disabled = true; $('rep-apply').disabled = true; root.setAttribute('aria-busy','true');
    try {
      const result = await api.get('/reports/analytics?' + q, true);
      if (!active() || ticket !== request || !result) return;
      data = result; appliedQuery = q; page = 1; render(); $('rep-results').hidden = false; $('rep-excel').disabled = false;
      $('rep-status').textContent = 'Actualizado: ' + new Date(data.actualizado).toLocaleString('es-PE', {timeZone:'America/Lima'});
      renderCharts();
    } catch (err) { if (active() && ticket === request) { data = null; destroy(); $('rep-status').classList.add('rep-error'); $('rep-status').textContent = 'No se pudo cargar el análisis: ' + err.message + ' Intenta actualizar nuevamente.'; } }
    finally { if (active() && ticket === request) { $('rep-apply').disabled = false; root.removeAttribute('aria-busy'); } }
  }
  const exports = [['pagos','Pagos'],['clientes','Clientes'],['asistencia','Asistencia'],['membresias','Membresías'],['pagos-pendientes','Saldos pendientes'],['stock','Stock de productos'],['ventas','Ventas'],['caja','Resumen de caja'],['ingresos-caja','Ingresos por cajero']];
  $('rep-export-list').innerHTML = exports.map(([type,title]) => `<article><h3>${title}</h3>${type === 'membresias' ? '<label class="rep-muted">Estado<select id="rep-membership-state" class="form-control"><option value="">Todos</option><option value="activo">Activo</option><option value="vencido">Vencido</option><option value="pendiente">Pendiente</option><option value="cancelado">Cancelado</option></select></label>' : ''}<div class="rep-actions" style="margin-top:10px"><button class="btn btn-outline" data-export="${type}" data-format="excel">Excel</button>${type === 'pagos' ? '<button class="btn btn-outline" data-export="pagos" data-format="pdf">PDF</button>' : ''}</div></article>`).join('');
  listen(root, 'click', async event => {
    const opener = event.target.closest('[data-open]'); if (opener && data) { selectView(opener.dataset.open); $('rep-detail').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}); }
    const tab = event.target.closest('[data-view]'); if (tab) selectView(tab.dataset.view);
    const button = event.target.closest('[data-export]');
    if (button) {
      try {
        const type = button.dataset.export, format = button.dataset.format;
        let q = ['pagos','asistencia','ventas','caja','ingresos-caja'].includes(type) ? query() : '';
        if (type === 'membresias') q = new URLSearchParams({estado:$('rep-membership-state').value}).toString();
        button.disabled = true;
        await api.download(`/reports/${type}/${format}?${q}`, `${type}-${day(new Date())}.${format === 'excel' ? 'xlsx' : 'pdf'}`);
      } catch (err) { if (active()) $('rep-status').textContent = err.message; }
      finally { if (active()) button.disabled = false; }
    }
  });
  listen(root, 'change', async event => {
    const select = event.target.closest('[data-track]'); if (!select || !data) return;
    const row = data.recommendations.find(r => r.clave === select.dataset.track), old = row.seguimiento.estado;
    select.disabled = true;
    try { const result = await api.put('/reports/seguimiento', {clave:row.clave, estado:select.value}); if (active() && result) { row.seguimiento = result; render(); } }
    catch (err) { if (active()) { select.value = old; $('rep-status').textContent = 'No se guardó el seguimiento: ' + err.message; } }
    finally { if (active()) select.disabled = false; }
  });
  listen($('rep-filters'), 'submit', event => { event.preventDefault(); load(); });
  listen($('rep-preset'), 'change', preset);
  ['rep-from','rep-to'].forEach(id => listen($(id),'change',()=>{ $('rep-preset').value='custom'; }));
  listen($('rep-compare'),'change',()=>{ if(data) renderCharts(); });
  listen($('rep-search'),'input',()=>{page=1;renderTable();});
  listen($('rep-follow-state'),'change',()=>{page=1;renderTable();});
  listen($('rep-prev'),'click',()=>{page--;renderTable();}); listen($('rep-next'),'click',()=>{page++;renderTable();});
  listen($('rep-print'),'click',()=>window.print());
  listen($('rep-excel'),'click',async()=>{
    $('rep-excel').disabled = true;
    try { await api.download('/reports/analytics/excel?'+appliedQuery,`analisis-${data.periodo.from}-${data.periodo.to}.xlsx`); }
    catch(err) { if(active()) $('rep-status').textContent=err.message; }
    finally { if(active() && data) $('rep-excel').disabled=false; }
  });
  const observer = new MutationObserver(()=>{if(data && active()) renderCharts();});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});
  signal?.addEventListener('abort',()=>observer.disconnect(),{once:true});
  $('rep-from').max = $('rep-to').max = day(new Date()); preset(); load();
};
