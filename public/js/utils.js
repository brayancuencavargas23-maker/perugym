// Toast notifications
function toast(msg, type = 'success', duration = 3500) {
  // Si es un error, también loggearlo en consola
  if (type === 'error') {
    console.error('[Toast Error]', msg);
    console.trace('Stack trace del error:');
  }
  
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const svgIcons = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
    error:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  const labels = { success: 'Éxito', error: 'Error', warning: 'Advertencia', info: 'Información' };

  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `
    <span class="toast-icon">${svgIcons[type] || svgIcons.info}</span>
    <div class="toast-body">
      <div class="toast-title">${labels[type] || type}</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <button class="toast-close" aria-label="Cerrar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="toast-progress" style="animation-duration:${duration}ms"></div>
  `;

  container.appendChild(t);

  // Cierre manual
  const dismiss = () => {
    if (t.classList.contains('toast-hiding')) return;
    t.classList.add('toast-hiding');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  };

  t.querySelector('.toast-close').addEventListener('click', dismiss);

  // Auto-dismiss
  const timer = setTimeout(dismiss, duration);

  // Pausar progreso al hacer hover
  t.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    t.querySelector('.toast-progress').style.animationPlayState = 'paused';
  });
  t.addEventListener('mouseleave', () => {
    t.querySelector('.toast-progress').style.animationPlayState = 'running';
    setTimeout(dismiss, 800);
  });
}

// ── Skeleton loaders ─────────────────────────────────────────────────────────
// Widths cycle para que cada columna tenga un ancho distinto y natural
const _skeletonWidths = ['w-70', 'w-55', 'w-40', 'w-80', 'w-30', 'w-20', 'w-55', 'w-70'];

/**
 * showTableSkeleton — Rellena un <tbody> con filas skeleton animadas.
 *
 * @param {string} tbodyId  - ID del <tbody> a rellenar
 * @param {number} cols     - Número de columnas de la tabla
 * @param {number} [rows=6] - Filas skeleton a mostrar
 *
 * Uso: showTableSkeleton('clientes-table', 6);
 *      const data = await api.get('/clientes');
 *      // renderizar data → las filas skeleton desaparecen solas
 */
function showTableSkeleton(tbodyId, cols, rows = 6) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: rows }, (_, r) =>
    `<tr class="skeleton-row">${
      Array.from({ length: cols }, (_, c) =>
        `<td><div class="skeleton-cell ${_skeletonWidths[(r + c) % _skeletonWidths.length]}"></div></td>`
      ).join('')
    }</tr>`
  ).join('');
}

/**
 * showCardsSkeleton — Rellena un contenedor con cards skeleton animadas.
 * Útil para grids de planes, productos en tarjeta, etc.
 *
 * @param {string} containerId - ID del contenedor
 * @param {number} [count=6]   - Número de cards skeleton
 *
 * Uso: showCardsSkeleton('plans-grid', 4);
 *      const plans = await api.get('/planes');
 *      // renderizar plans → las cards skeleton desaparecen solas
 */
function showCardsSkeleton(containerId, count = 6) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line short"></div>
      <div class="skeleton-line price"></div>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line full"></div>
      <div class="skeleton-line short"></div>
    </div>
  `).join('');
}


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
  sessionStorage.clear(); // también borra _sidebar_html
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
// _hamburgerInitialized evita registrar listeners de document/window
// mas de una vez en el SPA (el sidebar se reconstruye pero el documento no).
var _hamburgerInitialized = false;
var _hamburgerClickHandler = null;

function initHamburger() {
  var btn     = document.getElementById('hamburger');
  var sidebar = document.getElementById('sidebar');
  if (!btn || !sidebar) return;

  // Inyectar el icono de 3 lineas si el boton esta vacio
  if (!btn.querySelector('.hamburger-icon')) {
    btn.innerHTML =
      '<span class="hamburger-icon" aria-hidden="true">' +
        '<span></span><span></span><span></span>' +
      '</span>';
  }
  btn.setAttribute('aria-label', 'Abrir menu de navegacion');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'sidebar');

  // Crear overlay si no existe
  var overlay = document.getElementById('sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
  }

  function openSidebar() {
    var b = document.getElementById('hamburger');
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebar-overlay');
    if (!b || !s || !o) return;
    s.classList.add('open');
    b.classList.add('is-open');
    b.setAttribute('aria-expanded', 'true');
    b.setAttribute('aria-label', 'Cerrar menu de navegacion');
    document.body.classList.add('sidebar-open');
    o.classList.add('visible');
    requestAnimationFrame(function() { o.classList.add('active'); });
    s.removeAttribute('aria-hidden');
  }

  function closeSidebar() {
    var b = document.getElementById('hamburger');
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebar-overlay');
    if (!s) return;
    s.classList.remove('open');
    if (b) {
      b.classList.remove('is-open');
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('aria-label', 'Abrir menu de navegacion');
    }
    document.body.classList.remove('sidebar-open');
    if (o) {
      o.classList.remove('active');
      o.addEventListener('transitionend', function handler() {
        o.classList.remove('visible');
        o.removeEventListener('transitionend', handler);
      });
      setTimeout(function() { o.classList.remove('visible'); }, 350);
    }
    s.setAttribute('aria-hidden', 'true');
  }

  // Limpiar listener anterior del boton antes de agregar uno nuevo
  if (_hamburgerClickHandler) {
    btn.removeEventListener('click', _hamburgerClickHandler);
  }
  _hamburgerClickHandler = function(e) {
    e.stopPropagation();
    var s = document.getElementById('sidebar');
    if (s && s.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  };
  btn.addEventListener('click', _hamburgerClickHandler);

  // Cerrar al hacer clic en el overlay
  overlay.onclick = closeSidebar;

  // Los siguientes listeners van al document/window una sola vez
  if (!_hamburgerInitialized) {
    // Event delegation: cerrar al navegar en movil
    document.addEventListener('click', function(e) {
      var navItem = e.target.closest('#sidebar .nav-item');
      if (navItem && window.innerWidth < 1024) {
        closeSidebar();
      }
    });

    // Cerrar con Escape
    document.addEventListener('keydown', function(e) {
      var s = document.getElementById('sidebar');
      if (e.key === 'Escape' && s && s.classList.contains('open')) {
        closeSidebar();
        var b = document.getElementById('hamburger');
        if (b) b.focus();
      }
    });

    // Cerrar si se redimensiona a desktop
    var _resizeTimer = null;
    window.addEventListener('resize', function() {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(function() {
        var s = document.getElementById('sidebar');
        if (window.innerWidth >= 1024 && s && s.classList.contains('open')) {
          closeSidebar();
        }
      }, 100);
    });

    _hamburgerInitialized = true;
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


/**
 * safeSetHTML — Set innerHTML con validación para evitar errores de null
 * 
 * @param {string} elementId - ID del elemento
 * @param {string} html - HTML a insertar
 * @param {string} [fallback=''] - HTML alternativo si el elemento no existe
 * @returns {boolean} - true si tuvo éxito, false si el elemento no existe
 * 
 * Uso:
 *   safeSetHTML('clientes-table', htmlContent);
 *   // En lugar de: document.getElementById('clientes-table').innerHTML = htmlContent;
 */
function safeSetHTML(elementId, html, fallback = '') {
  const el = document.getElementById(elementId);
  if (!el) {
    console.warn(`[safeSetHTML] ⚠️ Elemento no encontrado: #${elementId}`);
    return false;
  }
  el.innerHTML = html || fallback;
  return true;
}

// ── Interceptor global de errores ───────────────────────────────────────────
window.addEventListener('error', (event) => {
  const msg = event.message || '';
  
  // Capturar errores de propiedades null
  if (msg.includes('Cannot set properties of null') || 
      msg.includes('Cannot read properties of null') ||
      msg.includes('null is not an object')) {
    
    console.error('🔴 ERROR CAPTURADO:', {
      mensaje: event.message,
      archivo: event.filename,
      línea: event.lineno,
      columna: event.colno,
      error: event.error
    });
    
    if (event.error && event.error.stack) {
      console.error('Stack trace:', event.error.stack);
    }
    
    // Intentar extraer qué propiedad se intentó acceder
    const match = msg.match(/setting '(\w+)'/);
    if (match) {
      console.error(`❌ Se intentó modificar la propiedad: ${match[1]}`);
    }
  }
}, true);

console.log('✅ Interceptor de errores activado');
