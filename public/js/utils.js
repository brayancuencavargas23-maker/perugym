// Toast notifications
function toast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  const icons = { success: '✅', error: '❌', warning: '⚠️' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || '💬'}</span> ${msg}`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Modal helpers
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// Format date
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD' }).format(n || 0);
}

// Days until expiry
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Pagination renderer
function renderPagination(container, current, total, onPage) {
  container.innerHTML = '';
  if (total <= 1) return;
  const prev = document.createElement('button');
  prev.className = 'page-btn';
  prev.textContent = '‹';
  prev.disabled = current === 1;
  prev.onclick = () => onPage(current - 1);
  container.appendChild(prev);

  for (let i = 1; i <= total; i++) {
    if (total > 7 && Math.abs(i - current) > 2 && i !== 1 && i !== total) {
      if (i === 2 || i === total - 1) {
        const dots = document.createElement('span');
        dots.textContent = '…';
        dots.style.padding = '0 4px';
        container.appendChild(dots);
      }
      continue;
    }
    const btn = document.createElement('button');
    btn.className = `page-btn${i === current ? ' active' : ''}`;
    btn.textContent = i;
    btn.onclick = () => onPage(i);
    container.appendChild(btn);
  }

  const next = document.createElement('button');
  next.className = 'page-btn';
  next.textContent = '›';
  next.disabled = current === total;
  next.onclick = () => onPage(current + 1);
  container.appendChild(next);
}

// Avatar initials
function avatarInitials(name) {
  return name ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '?';
}

// ── Auth guard ────────────────────────────────────────────────────────────────
// Decodifica el JWT localmente para verificar existencia y expiración.
// La firma se valida en el servidor en cada llamada API.
function _isTokenValid() {
  const token = localStorage.getItem('gym_token');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !(payload.exp && payload.exp * 1000 < Date.now());
  } catch {
    return false;
  }
}

function _redirectToLogin() {
  localStorage.removeItem('gym_token');
  localStorage.removeItem('gym_user');
  sessionStorage.clear();
  if (typeof gymCache !== 'undefined') gymCache.clear();
  window.location.replace('/login.html');
}

function requireAuth() {
  if (!_isTokenValid()) {
    _redirectToLogin();
    return null;
  }
  return JSON.parse(localStorage.getItem('gym_user') || '{}');
}

// ── Protección contra bfcache ─────────────────────────────────────────────────
// El navegador puede restaurar páginas desde memoria al presionar "atrás"
// sin ejecutar ningún script ni hacer peticiones HTTP (bfcache).
// El evento 'pageshow' SÍ se dispara en ese caso: persisted=true indica
// que la página viene del bfcache. Aquí verificamos el token y redirigimos
// si ya no es válido (el usuario hizo logout).
window.addEventListener('pageshow', (e) => {
  // Solo actuar en páginas protegidas (las que tienen gym_token como requisito)
  // login.html no llama a requireAuth, así que este listener no interfiere allí
  const isProtectedPage = document.querySelector('script[src*="layout.js"]');
  if (!isProtectedPage) return;

  if (e.persisted || performance.getEntriesByType('navigation')[0]?.type === 'back_forward') {
    if (!_isTokenValid()) {
      _redirectToLogin();
    }
  }
});

// Sidebar active
function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

// Hamburger toggle
function initHamburger() {
  const btn = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  if (btn && sidebar) {
    btn.onclick = () => sidebar.classList.toggle('open');
    document.addEventListener('click', e => {
      if (!sidebar.contains(e.target) && e.target !== btn) sidebar.classList.remove('open');
    });
  }
}

// Custom confirm dialog — replaces native confirm()
// Usage: confirmDialog({ message, title, confirmText, type }).then(ok => { if (ok) ... })
function confirmDialog({ message, title = '¿Confirmar acción?', confirmText = 'Confirmar', type = 'danger' } = {}) {
  return new Promise(resolve => {
    // Remove any existing confirm dialog
    const existing = document.getElementById('_confirm-overlay');
    if (existing) existing.remove();

    const colorMap = { danger: 'var(--danger)', warning: '#856404', primary: 'var(--primary)', success: 'var(--success)' };
    const bgMap    = { danger: 'rgba(220,53,69,0.08)', warning: 'rgba(255,193,7,0.08)', primary: 'rgba(108,99,255,0.08)', success: 'rgba(40,167,69,0.08)' };
    const iconMap  = { danger: '🗑️', warning: '⚠️', primary: '❓', success: '✅' };
    const color    = colorMap[type] || colorMap.danger;
    const bg       = bgMap[type]    || bgMap.danger;
    const ico      = iconMap[type]  || iconMap.danger;

    const overlay = document.createElement('div');
    overlay.id = '_confirm-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.45);
      display:flex;align-items:center;justify-content:center;
      z-index:9998;padding:20px;animation:_cfadeIn .15s ease;
    `;

    overlay.innerHTML = `
      <style>
        @keyframes _cfadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes _cslideUp { from { transform:translateY(16px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      </style>
      <div style="
        background:#fff;border-radius:16px;width:100%;max-width:400px;
        box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;
        animation:_cslideUp .18s ease;
      ">
        <div style="padding:28px 28px 20px;text-align:center">
          <div style="
            width:56px;height:56px;border-radius:50%;background:${bg};
            display:flex;align-items:center;justify-content:center;
            font-size:26px;margin:0 auto 16px;
          ">${ico}</div>
          <h3 style="font-size:17px;font-weight:700;margin-bottom:8px;color:#1a1a2e">${title}</h3>
          <p style="font-size:14px;color:#666;line-height:1.5">${message}</p>
        </div>
        <div style="
          padding:16px 28px 24px;display:flex;gap:10px;justify-content:center;
        ">
          <button id="_confirm-cancel" style="
            flex:1;padding:10px 20px;border:1px solid #e0e0e0;border-radius:8px;
            background:#fff;font-size:14px;font-weight:600;cursor:pointer;
            color:#666;transition:background .15s;
          ">Cancelar</button>
          <button id="_confirm-ok" style="
            flex:1;padding:10px 20px;border:none;border-radius:8px;
            background:${color};color:#fff;font-size:14px;font-weight:600;
            cursor:pointer;transition:opacity .15s;
          ">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (result) => { overlay.remove(); resolve(result); };
    document.getElementById('_confirm-ok').onclick     = () => cleanup(true);
    document.getElementById('_confirm-cancel').onclick = () => cleanup(false);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
  });
}

/**
 * withLoading — Protege un botón contra doble clic durante operaciones async.
 *
 * - Deshabilita el botón ANTES del await (previene doble submit)
 * - Muestra spinner + texto de carga
 * - Restaura el botón al terminar, tanto en éxito como en error
 *
 * @param {HTMLElement} btn        - El botón a proteger
 * @param {Function}    fn         - Función async a ejecutar
 * @param {string}      [loadingText='Guardando...'] - Texto mientras carga
 *
 * Uso:
 *   await withLoading(btn, async () => {
 *     await api.post('/clientes', body);
 *     toast('Cliente creado');
 *   });
 */
async function withLoading(btn, fn, loadingText = 'Guardando...') {
  if (btn.disabled) return;           // ya hay una operación en curso — ignorar clic

  const originalHTML = btn.innerHTML;
  const originalDisabled = btn.disabled;

  // Deshabilitar inmediatamente, antes de cualquier await
  btn.disabled = true;
  btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">
    <svg style="animation:_spin .7s linear infinite;width:14px;height:14px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    ${loadingText}
  </span>`;

  // Inyectar keyframe del spinner una sola vez
  if (!document.getElementById('_spin-style')) {
    const s = document.createElement('style');
    s.id = '_spin-style';
    s.textContent = '@keyframes _spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }

  try {
    await fn();
  } finally {
    // Siempre restaurar, incluso si fn() lanza error
    btn.disabled = originalDisabled;
    btn.innerHTML = originalHTML;
  }
}
