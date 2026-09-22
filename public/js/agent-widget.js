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
      <div class="agent-panel" id="agent-panel">
        <div class="agent-header">
          <div class="agent-header-icon">${ICONS.bot}</div>
          <div class="agent-header-info">
            <h3>Asistente PeruGym</h3>
            <p>Groq IA · Asistente virtual</p>
          </div>
          <button class="agent-header-close" id="agent-close">${ICONS.close}</button>
        </div>
        <div class="agent-messages" id="agent-messages">
          <div class="agent-msg system">Bienvenido. Soy tu asistente con Groq IA. Pregúntame sobre socios, membresías, pagos o asistencia.</div>
        </div>
        <div class="agent-typing" id="agent-typing">
          <div class="agent-typing-dot"></div>
          <div class="agent-typing-dot"></div>
          <div class="agent-typing-dot"></div>
        </div>
        <div class="agent-input-area">
          <input type="text" id="agent-input" placeholder="Escribe tu pregunta..." maxlength="500" autocomplete="off" />
          <button class="agent-send-btn" id="agent-send">${ICONS.send}</button>
        </div>
        <div class="agent-footer">Powered by Groq · 30 consultas/hora</div>
      </div>
      <button class="agent-fab" id="agent-fab">${ICONS.bot}</button>
    `;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function addMessage(role, content) {
    const messages = document.getElementById('agent-messages');
    const msg = document.createElement('div');
    msg.className = `agent-msg ${role}`;
    msg.textContent = content;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    return msg;
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

      addMessage('assistant', data.respuesta);
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
      if (isOpen) {
        document.getElementById('agent-input').focus();
      }
    });

    document.getElementById('agent-close').addEventListener('click', () => {
      isOpen = false;
      document.getElementById('agent-panel').classList.remove('open');
      document.getElementById('agent-fab').classList.remove('active');
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
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    createWidget();
    bindEvents();
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
