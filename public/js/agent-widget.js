/**
 * Agent Widget - Chat flotante para PeruGym
 */
(function () {
  'use strict';

  // ── SVG Icons ──────────────────────────────────────────────────────────────
  const ICONS = {
    bot: `<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM9.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    send: `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
    chat: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`,
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let isOpen = false;
  let isLoading = false;

  // ── DOM ────────────────────────────────────────────────────────────────────
  function createWidget() {
    const wrapper = document.createElement('div');
    wrapper.className = 'agent-widget';
    wrapper.innerHTML = `
      <div class="agent-panel" id="agent-panel" role="dialog" aria-label="Asistente PeruGym">
        <div class="agent-header">
          <div class="agent-header-icon">${ICONS.bot}</div>
          <div class="agent-header-info">
            <h3>Asistente PeruGym</h3>
            <p>Reportes, recomendaciones y clientes</p>
          </div>
          <button class="agent-header-close" id="agent-close" aria-label="Cerrar asistente">${ICONS.close}</button>
        </div>
        <div class="agent-tools" aria-label="Accesos rápidos">
          <button type="button" data-agent-mode="report" aria-expanded="false">Reportes</button>
          <button type="button" data-agent-mode="recommend">Recomendaciones</button>
          <button type="button" data-agent-mode="message" aria-expanded="false">Mensajes</button>
          <button type="button" id="agent-clear">Limpiar chat</button>
        </div>
        <form id="agent-report-form" class="agent-workspace" hidden>
          <label for="agent-report-type">Reporte</label>
          <select id="agent-report-type"><option value="general">Resumen general</option><option value="pagos">Pagos</option><option value="asistencia">Asistencia</option><option value="membresias">Membresías</option><option value="ventas">Ventas</option><option value="stock">Stock actual</option><option value="pagos-pendientes">Saldos actuales</option></select>
          <div class="agent-form-row"><div><label for="agent-from">Desde</label><input id="agent-from" type="date" required></div><div><label for="agent-to">Hasta</label><input id="agent-to" type="date" required></div></div>
          <label for="agent-format">Formato</label><select id="agent-format"><option value="excel">Excel</option><option value="pdf" disabled>PDF (solo pagos)</option></select>
          <button type="submit">Preparar reporte</button>
        </form>
        <form id="agent-message-form" class="agent-workspace" hidden>
          <label for="agent-client-search">Buscar cliente por nombre o DNI</label>
          <div class="agent-form-row"><input id="agent-client-search" type="search" minlength="2" maxlength="100" placeholder="Nombre o DNI"><button id="agent-find-client" type="button">Buscar</button></div>
          <p id="agent-client-status" role="status"></p>
          <label for="agent-client-select">Cliente destinatario</label><select id="agent-client-select" required><option value="">Busca y selecciona un cliente</option></select>
          <label for="agent-message-reason">Motivo</label><select id="agent-message-reason"><option value="general">Consulta general</option><option value="renovacion">Renovación</option><option value="pago">Saldo pendiente</option><option value="inasistencia">Retomar entrenamientos</option></select>
          <button type="submit">Preparar mensaje editable</button>
        </form>
        <div class="agent-messages" id="agent-messages" role="log" aria-live="polite" aria-label="Conversación">
          <div class="agent-msg system">Consulta datos del gimnasio, descarga reportes o prepara mensajes individuales por WhatsApp. Prueba: “Dame recomendaciones para este mes”.</div>
        </div>
        <div class="agent-typing" id="agent-typing">
          <div class="agent-typing-dot"></div>
          <div class="agent-typing-dot"></div>
          <div class="agent-typing-dot"></div>
        </div>
        <div class="agent-input-area">
          <input type="text" id="agent-input" aria-label="Consulta al asistente" placeholder="Escribe tu pregunta..." maxlength="500" autocomplete="off" />
          <button class="agent-send-btn" id="agent-send" aria-label="Enviar consulta">${ICONS.send}</button>
        </div>
        <div class="agent-footer">Datos reales del gimnasio · El envío de mensajes se completa en WhatsApp</div>
      </div>
      <button class="agent-fab" id="agent-fab" aria-label="Abrir asistente" aria-expanded="false" aria-controls="agent-panel">${ICONS.bot}</button>
    `;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function addMessage(role, content, actions = []) {
    const messages = document.getElementById('agent-messages');
    const msg = document.createElement('div');
    msg.className = `agent-msg ${role}`;
    const text = document.createElement('div');
    text.className = 'agent-message-text';
    text.textContent = content;
    msg.appendChild(text);
    actions.forEach(action => renderAction(msg, action));
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    return msg;
  }

  async function callApi(path, options = {}) {
    const res = await fetch('/api' + path, { ...options, headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('gym_token'),
    } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo completar la consulta.');
    return data;
  }

  function renderAction(parent, action) {
    if (!action || typeof action !== 'object') return;
    if (action.tipo === 'mensaje' && /^[1-9]\d{9,14}$/.test(action.telefono)) {
      const card = document.createElement('div'); card.className = 'agent-action';
      const title = document.createElement('strong'); title.textContent = `${action.nombre} · +${action.telefono}`;
      const label = document.createElement('label'); label.textContent = 'Mensaje editable';
      const field = document.createElement('textarea'); field.value = action.mensaje || ''; field.maxLength = 1500; field.rows = 5;
      label.appendChild(field);
      const link = document.createElement('a'); link.textContent = 'Abrir WhatsApp'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const note = document.createElement('small'); note.textContent = 'Revisa el texto y pulsa enviar en WhatsApp.';
      const refresh = () => {
        if (field.value.trim()) { link.href = `https://wa.me/${action.telefono}?text=${encodeURIComponent(field.value.trim())}`; link.removeAttribute('aria-disabled'); }
        else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
      };
      field.addEventListener('input', refresh); refresh();
      card.append(title, label, link, note); parent.appendChild(card);
    } else if (action.tipo === 'preparar_mensaje') {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'agent-action-button'; btn.textContent = action.titulo;
      btn.addEventListener('click', () => runQuick('Preparar mensaje para cliente', '/agente/mensaje', {
        method: 'POST', body: JSON.stringify({ cliente_id: action.cliente_id, motivo: action.motivo }),
      }));
      parent.appendChild(btn);
    } else if (action.tipo === 'descarga' && /^\/reports\/(analytics|pagos|asistencia|membresias|ventas|stock|pagos-pendientes)\/(excel|pdf)\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(action.path)) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'agent-action-button'; btn.textContent = action.titulo;
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Descargando…';
        try {
          const res = await fetch('/api' + action.path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('gym_token') } });
          if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'No se pudo descargar el reporte.'); }
          const url = URL.createObjectURL(await res.blob());
          const link = document.createElement('a'); link.href = url; link.download = action.archivo || 'reporte.xlsx';
          document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) { addMessage('assistant', err.message); }
        finally { btn.disabled = false; btn.textContent = action.titulo; }
      });
      parent.appendChild(btn);
    }
  }

  async function runQuick(label, path, options) {
    if (isLoading) return;
    addMessage('user', label); setLoading(true); setTyping(true);
    try {
      const data = await callApi(path, options);
      showWorkspace(null);
      addMessage('assistant', data.respuesta, data.acciones || []);
    } catch (err) { addMessage('assistant', err.message); }
    finally { setLoading(false); setTyping(false); }
  }

  function showWorkspace(mode) {
    document.getElementById('agent-report-form').hidden = mode !== 'report';
    document.getElementById('agent-message-form').hidden = mode !== 'message';
    document.querySelectorAll('[data-agent-mode]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.agentMode === mode)));
  }

  function setTyping(active) {
    const typing = document.getElementById('agent-typing');
    typing.classList.toggle('active', active);
    const messages = document.getElementById('agent-messages');
    messages.scrollTop = messages.scrollHeight;
  }

  function setLoading(loading) {
    isLoading = loading;
    const btn = document.getElementById('agent-send');
    const input = document.getElementById('agent-input');
    btn.disabled = loading;
    input.disabled = loading;
    document.querySelectorAll('.agent-tools button, .agent-workspace button').forEach(b => { b.disabled = loading; });
  }

  // ── API ────────────────────────────────────────────────────────────────────
  async function sendMessage(text) {
    if (isLoading || !text.trim()) return;

    addMessage('user', text.trim());
    setLoading(true);
    setTyping(true);
    document.getElementById('agent-input').value = '';

    try {
      const token = localStorage.getItem('gym_token');
      const res = await fetch('/api/agente/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ mensaje: text.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al consultar al agente');
      }

      addMessage('assistant', data.respuesta, data.acciones || []);
    } catch (err) {
      console.error('[Agent Widget]', err);
      addMessage('assistant', `⚠️ ${err.message}`);
    } finally {
      setTyping(false);
      setLoading(false);
      document.getElementById('agent-input').focus();
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('agent-fab').addEventListener('click', () => {
      isOpen = !isOpen;
      document.getElementById('agent-panel').classList.toggle('open', isOpen);
      document.getElementById('agent-fab').classList.toggle('active', isOpen);
      document.getElementById('agent-fab').setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        document.getElementById('agent-input').focus();
      }
    });

    document.getElementById('agent-close').addEventListener('click', () => {
      isOpen = false;
      document.getElementById('agent-panel').classList.remove('open');
      document.getElementById('agent-fab').classList.remove('active');
      document.getElementById('agent-fab').setAttribute('aria-expanded', 'false');
      document.getElementById('agent-fab').focus();
    });

    document.getElementById('agent-send').addEventListener('click', () => {
      const input = document.getElementById('agent-input');
      sendMessage(input.value);
    });

    document.getElementById('agent-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(e.target.value);
      }
    });

    document.getElementById('agent-panel').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); document.getElementById('agent-close').click(); }
    });
    document.querySelectorAll('[data-agent-mode]').forEach(btn => btn.addEventListener('click', () => {
      const mode = btn.dataset.agentMode;
      if (mode === 'recommend') return runQuick('Recomendaciones del gimnasio', '/agente/recomendaciones');
      showWorkspace(btn.getAttribute('aria-expanded') === 'true' ? null : mode);
      document.getElementById(mode === 'report' ? 'agent-report-type' : 'agent-client-search').focus();
    }));
    document.getElementById('agent-report-type').addEventListener('change', e => {
      const format = document.getElementById('agent-format');
      format.options[1].disabled = e.target.value !== 'pagos';
      if (format.options[1].disabled) format.value = 'excel';
    });
    document.getElementById('agent-report-form').addEventListener('submit', e => {
      e.preventDefault();
      const from = document.getElementById('agent-from').value, to = document.getElementById('agent-to').value;
      if (from > to) return addMessage('assistant', 'La fecha inicial debe ser anterior o igual a la final.');
      const qs = new URLSearchParams({ from, to, tipo: document.getElementById('agent-report-type').value, formato: document.getElementById('agent-format').value });
      runQuick(`Reporte del ${from} al ${to}`, '/agente/reporte?' + qs);
    });
    let searchRequest = 0;
    const searchInput = document.getElementById('agent-client-search');
    searchInput.addEventListener('input', () => {
      searchRequest++;
      document.getElementById('agent-client-select').replaceChildren(new Option('Busca y selecciona un cliente', ''));
      document.getElementById('agent-client-status').textContent = '';
    });
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('agent-find-client').click(); } });
    document.getElementById('agent-find-client').addEventListener('click', async () => {
      const current = ++searchRequest, status = document.getElementById('agent-client-status');
      const select = document.getElementById('agent-client-select');
      select.replaceChildren(new Option('Busca y selecciona un cliente', ''));
      status.textContent = 'Buscando…';
      try {
        const data = await callApi('/agente/clientes?q=' + encodeURIComponent(searchInput.value.trim()));
        if (current !== searchRequest) return;
        data.clientes.forEach(c => select.add(new Option(`${c.nombre} · DNI ${c.dni || 'sin registrar'} · ${c.telefono || 'sin teléfono'}`, c.id)));
        status.textContent = data.clientes.length ? `${data.clientes.length} coincidencias. Selecciona el destinatario.` : 'No se encontraron clientes.';
      } catch (err) { if (current === searchRequest) status.textContent = err.message; }
    });
    document.getElementById('agent-message-form').addEventListener('submit', e => {
      e.preventDefault();
      runQuick('Preparar mensaje para cliente', '/agente/mensaje', { method: 'POST', body: JSON.stringify({
        cliente_id: document.getElementById('agent-client-select').value, motivo: document.getElementById('agent-message-reason').value,
      }) });
    });
    document.getElementById('agent-clear').addEventListener('click', async () => {
      if (isLoading) return;
      setLoading(true);
      try {
        await callApi('/agente/historial', { method: 'DELETE' });
        document.getElementById('agent-messages').replaceChildren();
        addMessage('system', 'Conversación limpiada. ¿En qué te ayudo?');
      } catch (err) { addMessage('assistant', err.message); }
      finally { setLoading(false); }
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('agent-panel')) return;
    createWidget();
    bindEvents();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    document.getElementById('agent-from').value = today.slice(0, 7) + '-01';
    document.getElementById('agent-to').value = today;
    document.getElementById('agent-from').max = today;
    document.getElementById('agent-to').max = today;
  }

  // Solo inicializar si hay token (usuario autenticado)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (localStorage.getItem('gym_token')) init();
    });
  } else {
    if (localStorage.getItem('gym_token')) init();
  }
})();
