// ─────────────────────────────────────────────────────────────────────────────
//  layout.js  —  Sidebar, Topbar, Right Panel (notificaciones) y User Dropdown
// ─────────────────────────────────────────────────────────────────────────────

function initLayout(activePage, pageTitle) {
  const user = requireAuth();
  if (!user) return;

  // ── Modo SPA: sidebar ya renderizado → solo actualizar ítem activo ──────────
  const _isSPAShell    = !!document.getElementById('spa-content');
  const _sidebarBuilt  = _isSPAShell && document.querySelector('#sidebar .nav-item');

  if (_sidebarBuilt) {
    document.querySelectorAll('#sidebar .nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === activePage);
    });
    // Si el topbar fue vaciado por el router, reconstruirlo
    if (!document.getElementById('topbar-user-name')) {
      document.getElementById('topbar').innerHTML = _buildTopbarHTML(user);
      _setupTopbarData(user);
      attachTopbarListeners();
    }
    return;
  }

  // ── Restaurar sidebar desde caché (evita flash negro) ───────────────────────
  const _cachedSidebar = sessionStorage.getItem('_sidebar_html');
  if (_cachedSidebar) {
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl && !sidebarEl.innerHTML.trim()) {
      sidebarEl.innerHTML = _cachedSidebar;
      sidebarEl.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === activePage);
      });
    }
  }

  // ── Secciones del sidebar ────────────────────────────────────────────────────
  const sections = [
    {
      label: 'Principal',
      items: [
        { page: 'dashboard', key: 'dashboard', label: 'Dashboard' },
        { page: 'reports',   key: 'reports',   label: 'Reportes'  },
      ],
    },
    {
      label: 'Membresías',
      items: [
        { page: 'clientes',    key: 'clientes',   label: 'Clientes'   },
        { page: 'membresias',  key: 'membresias', label: 'Membresías' },
        { page: 'planes',      key: 'planes',     label: 'Planes'     },
        { page: 'solicitudes', key: 'solicitudes',label: 'Solicitudes'},
      ],
    },
    {
      label: 'Operaciones',
      items: [
        { page: 'asistencia', key: 'asistencia', label: 'Asistencia' },
        { page: 'pagos',      key: 'pagos',      label: 'Pagos'      },
        { page: 'caja',       key: 'caja',       label: 'Caja'       },
        { page: 'productos',  key: 'productos',  label: 'Productos'  },
      ],
    },
    {
      label: 'Administración',
      adminOnly: true,
      items: [
        { page: 'users',         key: 'users',  label: 'Usuarios',     adminOnly: true },
        { page: 'landing-admin', key: 'image',  label: 'Landing Page', adminOnly: true },
      ],
    },
  ];

  const userPermisos = user.permisos || [];
  const isAdmin      = user.role === 'admin';

  const navHTML = sections.map(section => {
    const visibleItems = section.items.filter(item => {
      if (item.adminOnly) return isAdmin;
      if (item.page === 'dashboard') return true;
      return isAdmin || userPermisos.includes(item.page);
    });
    if (visibleItems.length === 0) return '';
    if (section.adminOnly && !isAdmin) return '';

    const itemsHTML = visibleItems.map(item => {
      const isActive      = activePage === item.page;
      const isSolicitudes = item.page === 'solicitudes';
      const isDashboard   = item.page === 'dashboard';
      const isAdminItem   = item.adminOnly;
      return `
        <a class="nav-item${isActive ? ' active' : ''}" data-page="${item.page}" href="/${item.page}.html">
          <span class="icon">${icon(item.key)}</span>
          ${item.label}
          ${isDashboard   ? '<span id="nav-badge-notificaciones" class="nav-badge" style="display:none"></span>' : ''}
          ${isSolicitudes ? '<span id="nav-badge-solicitudes"    class="nav-badge" style="display:none"></span>' : ''}
          ${isAdminItem   ? '<span class="nav-badge-admin">ADMIN</span>' : ''}
          <span class="nav-active-dot"></span>
        </a>`;
    }).join('');

    return `
      <div class="nav-section-label">${section.label}</div>
      ${itemsHTML}`;
  }).join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-header">
      <img src="/imagenes/index/Gemini_Generated_Image_ov0xhjov0xhjov0x-removebg-preview.png"
           alt="PeruGym" class="sidebar-logo-img" width="42" height="42">
      <div>
        <h2>PeruGym</h2>
        <p>Sistema de Gestión</p>
      </div>
    </div>
    <nav class="sidebar-nav">${navHTML}</nav>
    <div class="sidebar-footer">
      <div class="user-info">
        <div class="user-avatar">${avatarInitials(user.name)}</div>
        <div>
          <div class="user-name">${user.name}</div>
          <div class="user-role">${user.role}</div>
        </div>
      </div>
      <button class="btn w-full btn-sm" onclick="logout()"
        style="display:flex;align-items:center;justify-content:center;gap:6px;
               background:rgba(220,53,69,0.15);color:#f87171;border:1px solid rgba(220,53,69,0.25);
               border-radius:7px;transition:all 0.2s;"
        onmouseover="this.style.background='rgba(220,53,69,0.28)'"
        onmouseout="this.style.background='rgba(220,53,69,0.15)'">
        ${icon('logout')} Cerrar sesión
      </button>
    </div>
  `;

  sessionStorage.setItem('_sidebar_html', document.getElementById('sidebar').innerHTML);

  // ── Badge solicitudes (sidebar) ──────────────────────────────────────────────
  const cachedStats = gymCache.get('/solicitudes/stats');
  if (cachedStats) {
    const badge = document.getElementById('nav-badge-solicitudes');
    if (badge && cachedStats.pendiente > 0) {
      badge.textContent    = cachedStats.pendiente;
      badge.style.display  = 'inline-block';
    }
  }
  fetch('/api/solicitudes/stats', { headers: { Authorization: `Bearer ${localStorage.getItem('gym_token')}` } })
    .then(r => r.json())
    .then(stats => {
      gymCache.set('/solicitudes/stats', stats);
      const badge = document.getElementById('nav-badge-solicitudes');
      if (badge) {
        badge.textContent   = stats.pendiente;
        badge.style.display = stats.pendiente > 0 ? 'inline-block' : 'none';
      }
    })
    .catch(() => {});

  // ── Topbar ───────────────────────────────────────────────────────────────────
  document.getElementById('topbar').innerHTML = _buildTopbarHTML(user);
  _setupTopbarData(user);
  attachTopbarListeners();
  initHamburger();
}

// ─────────────────────────────────────────────────────────────────────────────
//  HTML del topbar
// ─────────────────────────────────────────────────────────────────────────────
function _buildTopbarHTML(user) {
  const roleLabel = user.role === 'admin' ? 'Administrador' : 'Operador';
  return `
    <!-- ── Izquierda ─────────────────────────────────────────────── -->
    <div class="topbar-left">
      <button class="hamburger" id="hamburger" aria-label="Abrir menú" aria-expanded="false" aria-controls="sidebar"></button>
      <div class="topbar-badge" id="topbar-aforo">
        <span class="dot"></span>
        AFORO: <strong id="aforo-count">--</strong>
      </div>
      <button class="topbar-checkin" id="topbar-checkin-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Check-in Rápido
      </button>
    </div>

    <!-- ── Derecha ───────────────────────────────────────────────── -->
    <div class="topbar-right">

      <!-- Toggle tema -->
      <button class="theme-toggle" id="theme-toggle" title="Cambiar tema">
        <span id="theme-icon">🌙</span>
      </button>

      <!-- Campanita de notificaciones -->
      <button class="topbar-icon-btn" id="topbar-notif-btn" title="Notificaciones" aria-label="Abrir notificaciones">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <span class="topbar-notif-count" id="topbar-notif-count" style="display:none"></span>
      </button>

      <!-- Perfil de usuario con dropdown -->
      <div class="topbar-profile-wrap" id="topbar-profile-wrap">
        <div class="topbar-profile" id="topbar-profile" role="button" tabindex="0" aria-haspopup="true" aria-expanded="false">
          <div class="topbar-avatar" id="topbar-avatar">${avatarInitials(user.name)}</div>
          <div class="topbar-user-info">
            <div class="topbar-user-name" id="topbar-user-name">${user.name}</div>
            <div class="topbar-user-role" id="topbar-user-role">${roleLabel}</div>
          </div>
          <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        <!-- Dropdown -->
        <div class="user-dropdown" id="user-dropdown" role="menu">
          <div class="user-dropdown-header">
            <div class="user-dropdown-avatar">${avatarInitials(user.name)}</div>
            <div>
              <div class="user-dropdown-name">${user.name}</div>
              <div class="user-dropdown-role">${roleLabel}</div>
            </div>
          </div>
          <div class="user-dropdown-body">
            <button class="user-dropdown-item danger" id="dropdown-logout" role="menuitem">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Right Panel: overlay + panel ─────────────────────────── -->
    <div class="panel-overlay" id="panel-overlay"></div>
    <div class="right-panel" id="right-panel" role="dialog" aria-label="Notificaciones">
      <div class="panel-header">
        <h2>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          Notificaciones
        </h2>
        <button class="panel-close" id="panel-close" aria-label="Cerrar panel">&#x2715;</button>
      </div>
      <div class="panel-body" id="panel-body">
        <div class="panel-loading">
          <div class="skel"></div><div class="skel"></div><div class="skel"></div>
        </div>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Datos del topbar (aforo, tema, badge notificaciones)
// ─────────────────────────────────────────────────────────────────────────────
function _setupTopbarData(user) {
  // Aforo en vivo
  fetch('/api/asistencia/aforo', { headers: { Authorization: 'Bearer ' + localStorage.getItem('gym_token') } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => {
      const el = document.getElementById('aforo-count');
      if (el) el.textContent = (d.actuales || 0) + '/' + (d.capacidad || 250);
    })
    .catch(() => {
      const el = document.getElementById('aforo-count');
      if (el) el.textContent = '--';
    });

  // Tema
  const savedTheme = localStorage.getItem('gym_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // Badge de notificaciones en la campanita
  _loadNotifBadge();
}

// Carga el conteo de notificaciones y actualiza el badge de la campanita
function _loadNotifBadge() {
  const token = localStorage.getItem('gym_token');
  if (!token) return;

  // Intentar desde caché primero (respuesta inmediata)
  const cached = gymCache.get('/dashboard/notifications');
  if (cached && cached.total != null) {
    _updateNotifBadge(cached.total);
  }

  fetch('/api/dashboard/notifications', { headers: { Authorization: 'Bearer ' + token } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      gymCache.set('/dashboard/notifications', data);
      _updateNotifBadge(data.total || 0);
    })
    .catch(() => {});
}

function _updateNotifBadge(count) {
  const el = document.getElementById('topbar-notif-count');
  if (!el) return;
  if (count > 0) {
    el.textContent   = count > 99 ? '99+' : count;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
  // Sincronizar también el badge del nav (Dashboard)
  const navBadge = document.getElementById('nav-badge-notificaciones');
  if (navBadge) {
    navBadge.textContent   = count > 99 ? '99+' : count;
    navBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Listeners del topbar
// ─────────────────────────────────────────────────────────────────────────────
function attachTopbarListeners() {
  // ── Campanita → abre el right panel ─────────────────────────────────────────
  const notifBtn = document.getElementById('topbar-notif-btn');
  if (notifBtn && !notifBtn._panelListener) {
    notifBtn.addEventListener('click', openRightPanel);
    notifBtn._panelListener = true;
  }

  // ── Right Panel: cerrar con overlay y botón × ────────────────────────────────
  const overlay   = document.getElementById('panel-overlay');
  const panelClose = document.getElementById('panel-close');
  if (overlay && !overlay._closeListener) {
    overlay.addEventListener('click', closeRightPanel);
    overlay._closeListener = true;
  }
  if (panelClose && !panelClose._closeListener) {
    panelClose.addEventListener('click', closeRightPanel);
    panelClose._closeListener = true;
  }

  // ── Dropdown de usuario ──────────────────────────────────────────────────────
  const profileBtn = document.getElementById('topbar-profile');
  const dropdown   = document.getElementById('user-dropdown');
  if (profileBtn && dropdown && !profileBtn._dropdownListener) {
    profileBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      _closeUserDropdown();
      if (!isOpen) {
        dropdown.classList.add('open');
        profileBtn.classList.add('open');
        profileBtn.setAttribute('aria-expanded', 'true');
      }
    });
    profileBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') profileBtn.click();
      if (e.key === 'Escape') _closeUserDropdown();
    });
    profileBtn._dropdownListener = true;
  }

  // Cerrar dropdown al hacer click fuera
  if (!document._dropdownOutsideListener) {
    document.addEventListener('click', e => {
      const wrap = document.getElementById('topbar-profile-wrap');
      if (wrap && !wrap.contains(e.target)) _closeUserDropdown();
    });
    document._dropdownOutsideListener = true;
  }

  // ── Botón Cerrar sesión dentro del dropdown ──────────────────────────────────
  const logoutBtn = document.getElementById('dropdown-logout');
  if (logoutBtn && !logoutBtn._logoutListener) {
    logoutBtn.addEventListener('click', logout);
    logoutBtn._logoutListener = true;
  }

  // ── Check-in rápido ──────────────────────────────────────────────────────────
  const checkinBtn = document.getElementById('topbar-checkin-btn');
  if (checkinBtn && !checkinBtn._checkinListener) {
    checkinBtn.addEventListener('click', () => {
      window.location.href = '/asistencia.html?checkin=quick';
    });
    checkinBtn._checkinListener = true;
  }

  // ── Toggle tema ──────────────────────────────────────────────────────────────
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn && !themeBtn._themeListener) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next    = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('gym_theme', next);
      updateThemeIcon(next);
    });
    themeBtn._themeListener = true;
  }
}

function _closeUserDropdown() {
  const dropdown   = document.getElementById('user-dropdown');
  const profileBtn = document.getElementById('topbar-profile');
  if (dropdown)   dropdown.classList.remove('open');
  if (profileBtn) {
    profileBtn.classList.remove('open');
    profileBtn.setAttribute('aria-expanded', 'false');
  }
}

function updateThemeIcon(theme) {
  const el = document.getElementById('theme-icon');
  if (el) el.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Right Panel — funciones globales (accesibles desde cualquier página)
// ─────────────────────────────────────────────────────────────────────────────
function openRightPanel() {
  const overlay = document.getElementById('panel-overlay');
  const panel   = document.getElementById('right-panel');
  if (!overlay || !panel) return;
  overlay.classList.add('open');
  panel.classList.add('open');
  document.body.style.overflow = 'hidden'; // evitar scroll del body
  loadPanelData();
}

function closeRightPanel() {
  document.getElementById('panel-overlay')?.classList.remove('open');
  document.getElementById('right-panel')?.classList.remove('open');
  document.body.style.overflow = '';
}

// Cierra el panel con tecla Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeRightPanel();
    _closeUserDropdown();
  }
});

async function loadPanelData() {
  const body = document.getElementById('panel-body');
  if (!body) return;

  // Mostrar skeleton mientras carga
  body.innerHTML = `
    <div class="panel-loading">
      <div class="skel"></div><div class="skel"></div><div class="skel"></div>
      <div class="skel"></div><div class="skel"></div>
    </div>`;

  const token = localStorage.getItem('gym_token');
  const headers = { Authorization: 'Bearer ' + token };

  try {
    const [activityRes, productsRes, membresiaRes, lowStockRes] = await Promise.allSettled([
      fetch('/api/dashboard/activity',      { headers }).then(r => r.ok ? r.json() : []),
      fetch('/api/dashboard/top-products',  { headers }).then(r => r.ok ? r.json() : {}),
      fetch('/api/dashboard?periodo=mes',   { headers }).then(r => r.ok ? r.json() : {}),
      fetch('/api/dashboard/low-stock',     { headers }).then(r => r.ok ? r.json() : { products: [] }),
    ]);

    const events     = activityRes.status  === 'fulfilled' ? activityRes.value  : [];
    const products   = productsRes.status  === 'fulfilled' ? productsRes.value  : {};
    const memData    = membresiaRes.status === 'fulfilled' ? membresiaRes.value : {};
    const lowStockData = lowStockRes.status === 'fulfilled' ? lowStockRes.value : { products: [] };

    let html = '';

    // ── Sección 1: Actividad Reciente ─────────────────────────────────────────
    const actItems = Array.isArray(events) ? events.slice(0, 8) : [];
    html += _panelSection(
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Actividad Reciente', actItems.length,
      actItems.length === 0
        ? '<div class="panel-empty">Sin actividad reciente</div>'
        : actItems.map(e => {
            const tipo      = e.icono || e.tipo || 'pago';
            const iconClass = tipo === 'pago' ? 'green' : tipo === 'asistencia' ? 'blue' : tipo === 'venta' ? 'orange' : 'purple';
            const icons = {
              pago:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
              asistencia: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
              membresia:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
              venta:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>',
            };
            return _panelItem(
              icons[tipo] || icons.pago, iconClass,
              e.titulo || '—',
              e.detalle || '',
              _timeAgo(e.fecha), 'info',
              e.link || null
            );
          }).join('')
    );

    // ── Sección 2: Productos con Stock Bajo ───────────────────────────────────
    const lowStock = (lowStockData.products || []);
    const stockIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    html += _panelSection(
      stockIcon + ' Stock Bajo', lowStock.length,
      lowStock.length === 0
        ? '<div class="panel-empty">Todos los productos tienen stock suficiente</div>'
        : lowStock.map(p => {
            const sev = p.stock === 0 ? 'danger' : p.stock <= 3 ? 'danger' : 'warning';
            const label = p.stock === 0 ? 'Sin stock' : p.stock + ' u.';
            const prodIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>';
            return _panelItem(prodIcon, sev, p.nombre, 'S/.' + (p.precio_venta || 0).toFixed(2) + ' — ' + (p.categoria || ''), label, sev, '/productos.html');
          }).join('')
    );

    // ── Sección 3: Membresías por Vencer ──────────────────────────────────────
    const vencen = (memData.membresiasVencenPronto || []);
    const clockIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    html += _panelSection(
      clockIcon + ' Por Vencer', vencen.length,
      vencen.length === 0
        ? '<div class="panel-empty">Sin membresías próximas a vencer</div>'
        : vencen.map(m => {
            const days = _daysUntil(m.fecha_fin);
            const sev  = days <= 1 ? 'danger' : days <= 3 ? 'warning' : 'info';
            const link = m.id ? '/membresias.html?renovar=' + m.id : '/membresias.html';
            const memIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>';
            return _panelItem(memIcon, sev, m.nombre || 'Sin nombre', m.plan_nombre || 'Sin plan', days === 0 ? 'Hoy' : days + 'd', sev, link);
          }).join('')
    );

    body.innerHTML = html;

    // Actualizar el badge después de cargar (datos frescos)
    if (memData.membresiasVencenPronto != null || lowStock.length != null) {
      _loadNotifBadge();
    }

  } catch {
    body.innerHTML = '<div class="panel-empty">Error al cargar los datos. Intenta de nuevo.</div>';
  }
}

// ── Helpers para construir HTML del panel ─────────────────────────────────────
function _panelSection(title, count, contentHTML) {
  return `
    <div class="panel-section">
      <div class="panel-section-title">
        ${title}
        <span class="count">${count}</span>
      </div>
      ${contentHTML}
    </div>`;
}

function _panelItem(emoji, iconClass, title, subtitle, badgeText, badgeClass, link) {
  const tag = link ? 'a' : 'div';
  const attrs = link ? `href="${link}" style="text-decoration:none;color:inherit;display:flex;align-items:flex-start;gap:12px;padding:12px;border-radius:12px;transition:background 0.2s;margin-bottom:6px;border:1px solid transparent;cursor:pointer"` : 'class="panel-item"';
  const hoverStyle = link ? ` onmouseover="this.style.background='var(--bg)';this.style.borderColor='var(--border)'" onmouseout="this.style.background='';this.style.borderColor='transparent'"` : '';
  return `
    <${tag} ${attrs}${hoverStyle}>
      <div class="panel-item-icon ${iconClass}">${emoji}</div>
      <div class="panel-item-text">
        <strong>${title}</strong>
        <span>${subtitle}</span>
      </div>
      <span class="panel-item-badge ${badgeClass}">${badgeText}</span>
    </${tag}>`;
}

function _timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'ahora';
  if (mins < 60) return mins + 'min';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

function _daysUntil(dateStr) {
  if (!dateStr) return 999;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr) - today) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Logout
// ─────────────────────────────────────────────────────────────────────────────
function logout() {
  gymCache.clear();

  const token = localStorage.getItem('gym_token');
  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  localStorage.removeItem('gym_token');
  localStorage.removeItem('gym_user');
  sessionStorage.clear();

  window.location.replace('/index.html');
}
