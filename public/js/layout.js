function initLayout(activePage, pageTitle) {
  const user = requireAuth();
  if (!user) return;

  // ── Secciones del sidebar ──────────────────────────────────────────────────
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

  // Filtrar según rol y permisos
  const userPermisos = user.permisos || [];
  const isAdmin = user.role === 'admin';

  const navHTML = sections.map(section => {
    // Filtrar items de la sección
    const visibleItems = section.items.filter(item => {
      if (item.adminOnly) return isAdmin;
      return isAdmin || userPermisos.includes(item.page);
    });
    if (visibleItems.length === 0) return '';
    if (section.adminOnly && !isAdmin) return '';

    const itemsHTML = visibleItems.map(item => {
      const isActive = activePage === item.page;
      const isSolicitudes = item.page === 'solicitudes';
      const isAdminItem = item.adminOnly;
      return `
        <a class="nav-item${isActive ? ' active' : ''}" data-page="${item.page}" href="/${item.page}.html">
          <span class="icon">${icon(item.key)}</span>
          ${item.label}
          ${isSolicitudes ? '<span id="nav-badge-solicitudes" class="nav-badge" style="display:none"></span>' : ''}
          ${isAdminItem ? '<span class="nav-badge-admin">ADMIN</span>' : ''}
          <span class="nav-active-dot"></span>
        </a>`;
    }).join('');

    return `
      <div class="nav-section-label">${section.label}</div>
      ${itemsHTML}`;
  }).join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-header">
      <img src="/imagenes/index/Gemini_Generated_Image_ov0xhjov0xhjov0x-removebg-preview.png" alt="PeruGym" class="sidebar-logo-img">
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

  // Cargar badge de solicitudes pendientes
  fetch('/api/solicitudes/stats', { headers: { Authorization: `Bearer ${localStorage.getItem('gym_token')}` } })
    .then(r => r.json())
    .then(stats => {
      const badge = document.getElementById('nav-badge-solicitudes');
      if (badge && stats.pendiente > 0) {
        badge.textContent = stats.pendiente;
        badge.style.display = 'inline-block';
      }
    })
    .catch(() => {});

  document.getElementById('topbar').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <button class="hamburger" id="hamburger">${icon('menu')}</button>
      <h1>${pageTitle}</h1>
    </div>
    <div class="topbar-actions" id="topbar-actions"></div>
  `;

  initHamburger();
}

function logout() {
  // 1. Limpiar caché en memoria
  gymCache.clear();

  // 2. Llamar al endpoint de logout (fire-and-forget, no bloqueamos la UI)
  const token = localStorage.getItem('gym_token');
  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => { /* ignorar errores de red en logout */ });
  }

  // 3. Limpiar todo el almacenamiento local
  localStorage.removeItem('gym_token');
  localStorage.removeItem('gym_user');
  sessionStorage.clear();

  // 4. Reemplazar la entrada actual en el historial para que el botón
  //    "atrás" no regrese al panel. replace() no agrega nueva entrada.
  window.location.replace('/login.html');
}
