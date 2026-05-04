function initLayout(activePage, pageTitle) {
  const user = requireAuth();
  if (!user) return;

  // ── Restaurar sidebar desde caché para eliminar el flash entre páginas ─────
  // Si ya existe el HTML del sidebar guardado en sessionStorage, lo inyectamos
  // de inmediato (antes de reconstruirlo) para que el usuario no vea el sidebar
  // vacío ni negro mientras los scripts terminan de ejecutarse.
  const _cachedSidebar = sessionStorage.getItem('_sidebar_html');
  if (_cachedSidebar) {
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl && !sidebarEl.innerHTML.trim()) {
      sidebarEl.innerHTML = _cachedSidebar;
      // Actualizar el ítem activo inmediatamente
      sidebarEl.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === activePage);
      });
    }
  }

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
      // dashboard siempre visible para cualquier usuario autenticado
      if (item.page === 'dashboard') return true;
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
      <img src="/imagenes/index/Gemini_Generated_Image_ov0xhjov0xhjov0x-removebg-preview.png" alt="PeruGym" class="sidebar-logo-img" width="42" height="42">
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

  // Guardar el HTML del sidebar en sessionStorage para restaurarlo
  // instantáneamente en la próxima navegación (elimina el flash)
  // Se guarda sin el ítem activo para que cada página lo marque correctamente
  sessionStorage.setItem('_sidebar_html', document.getElementById('sidebar').innerHTML);

  // Cargar badge de solicitudes pendientes
  // Primero mostrar desde caché para evitar parpadeo en producción
  const cachedStats = gymCache.get('/solicitudes/stats');
  if (cachedStats) {
    const badge = document.getElementById('nav-badge-solicitudes');
    if (badge && cachedStats.pendiente > 0) {
      badge.textContent = cachedStats.pendiente;
      badge.style.display = 'inline-block';
    }
  }
  fetch('/api/solicitudes/stats', { headers: { Authorization: `Bearer ${localStorage.getItem('gym_token')}` } })
    .then(r => r.json())
    .then(stats => {
      gymCache.set('/solicitudes/stats', stats);
      const badge = document.getElementById('nav-badge-solicitudes');
      if (badge) {
        if (stats.pendiente > 0) {
          badge.textContent = stats.pendiente;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    })
    .catch(() => {});

  document.getElementById('topbar').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <button class="hamburger" id="hamburger" aria-label="Abrir menú de navegación" aria-expanded="false" aria-controls="sidebar"></button>
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
  sessionStorage.clear(); // también borra _sidebar_html

  // 4. Reemplazar la entrada actual en el historial para que el botón
  //    "atrás" no regrese al panel. replace() no agrega nueva entrada.
  window.location.replace('/login.html');
}
