/**
 * app-responsive.js — Toggle hamburguesa para PeruGym
 *
 * Responsabilidades:
 *   - Abrir/cerrar el sidebar en móvil (<1024px)
 *   - Gestionar overlay, aria-* y body.sidebar-open
 *   - Evitar duplicar listeners en re-inicializaciones SPA
 *   - Actuar como respaldo de initHamburger() de layout.js
 *
 * Restricciones:
 *   - Sin módulos ES6 (import/export)
 *   - Sin llamadas a gymCache, api.get, api.post ni sistema de caché
 *   - Compatible con <script src="..."> directo
 *
 * Requisitos: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 8.2, 8.4, 8.5, 9.2, 10.1, 10.4
 */

(function () {
  'use strict';

  // ── Registro de listeners para limpieza en re-inicialización ──────────────
  // Permite llamar initResponsiveMenu() N veces sin duplicar listeners.
  // Req 8.4, 8.5
  var _listeners = [];

  function _removeListeners() {
    _listeners.forEach(function (entry) {
      entry.el.removeEventListener(entry.type, entry.fn);
    });
    _listeners = [];
  }

  function _on(el, type, fn) {
    el.addEventListener(type, fn);
    _listeners.push({ el: el, type: type, fn: fn });
  }

  // ── openSidebar ───────────────────────────────────────────────────────────
  // Req 2.2, 2.7, 10.1, 10.4
  function openSidebar(hamburger, sidebar, overlay) {
    // 1. Mostrar sidebar
    sidebar.classList.add('open');

    // 2. Overlay: primero visible (display), luego active (opacidad) en el
    //    siguiente frame para que la transición CSS funcione correctamente.
    overlay.classList.add('visible');
    requestAnimationFrame(function () {
      overlay.classList.add('active');
    });

    // 3. Bloquear scroll del body
    document.body.classList.add('sidebar-open');

    // 4. Animación X en el botón hamburguesa
    hamburger.classList.add('is-open');

    // 5. Atributos ARIA — Req 2.7, 10.1
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.setAttribute('aria-label', 'Cerrar menú de navegación');

    // 6. Sidebar accesible — Req 10.4
    sidebar.removeAttribute('aria-hidden');
  }

  // ── closeSidebar ──────────────────────────────────────────────────────────
  // Req 2.3, 2.4, 2.5, 2.6, 2.7, 10.1, 10.4
  function closeSidebar(hamburger, sidebar, overlay) {
    // 1. Ocultar sidebar
    sidebar.classList.remove('open');

    // 2. Overlay: quitar active (inicia transición de opacidad),
    //    luego quitar visible tras transitionend (o fallback 300ms).
    overlay.classList.remove('active');

    var _overlayTimer = null;

    function _onOverlayTransitionEnd(e) {
      // Solo reaccionar a la transición de opacity del propio overlay
      if (e && e.target !== overlay) return;
      clearTimeout(_overlayTimer);
      overlay.removeEventListener('transitionend', _onOverlayTransitionEnd);
      overlay.classList.remove('visible');
    }

    overlay.addEventListener('transitionend', _onOverlayTransitionEnd);

    // Fallback: si transitionend no dispara en 300ms, quitar visible igualmente
    _overlayTimer = setTimeout(function () {
      overlay.removeEventListener('transitionend', _onOverlayTransitionEnd);
      overlay.classList.remove('visible');
    }, 300);

    // 3. Restaurar scroll del body
    document.body.classList.remove('sidebar-open');

    // 4. Restaurar animación del botón hamburguesa
    hamburger.classList.remove('is-open');

    // 5. Atributos ARIA — Req 2.7, 10.1
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Abrir menú de navegación');

    // 6. Sidebar oculto para lectores de pantalla — Req 10.4
    sidebar.setAttribute('aria-hidden', 'true');
  }

  // ── initResponsiveMenu ────────────────────────────────────────────────────
  // Función principal. Puede llamarse múltiples veces de forma segura.
  // Req 2.8, 8.4, 8.5, 9.2
  function initResponsiveMenu() {
    // Guard clause: si los elementos esenciales no existen, salir sin error.
    // Req 2.8
    var hamburger = document.getElementById('hamburger');
    var sidebar   = document.getElementById('sidebar');
    if (!hamburger || !sidebar) return;

    // El overlay es opcional; si no existe, crear uno en memoria para que
    // openSidebar/closeSidebar no fallen. En app.html siempre existe.
    var overlay = document.getElementById('sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebar-overlay';
      overlay.className = 'sidebar-overlay';
      document.body.appendChild(overlay);
    }

    // Limpiar listeners anteriores antes de re-registrar — Req 8.4, 8.5
    _removeListeners();

    // ── Estado inicial ────────────────────────────────────────────────────
    // Si el sidebar no está abierto, establecer estado ARIA inicial.
    if (!sidebar.classList.contains('open')) {
      sidebar.setAttribute('aria-hidden', 'true');
      hamburger.setAttribute('aria-expanded', 'false');
    }

    // ── Listener: clic en #hamburger (toggle) ─────────────────────────────
    // Req 2.2, 2.3
    _on(hamburger, 'click', function () {
      if (sidebar.classList.contains('open')) {
        closeSidebar(hamburger, sidebar, overlay);
      } else {
        openSidebar(hamburger, sidebar, overlay);
      }
    });

    // ── Listener: clic en #sidebar-overlay (cierra) ───────────────────────
    // Req 2.3
    _on(overlay, 'click', function () {
      closeSidebar(hamburger, sidebar, overlay);
    });

    // ── Listener: tecla Escape (cierra y devuelve foco) ───────────────────
    // Req 2.4
    _on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        closeSidebar(hamburger, sidebar, overlay);
        hamburger.focus();
      }
    });

    // ── Listener: clic en .nav-item dentro del sidebar (cierra en móvil) ──
    // Usa event delegation en el sidebar para capturar todos los nav-items.
    // Req 2.5
    _on(sidebar, 'click', function (e) {
      var navItem = e.target.closest('.nav-item');
      if (navItem && window.innerWidth < 1024) {
        closeSidebar(hamburger, sidebar, overlay);
      }
    });

    // ── Listener: resize con debounce 100ms (cierra si ≥1024px) ──────────
    // Req 2.6
    var _resizeTimer = null;
    _on(window, 'resize', function () {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(function () {
        if (window.innerWidth >= 1024 && sidebar.classList.contains('open')) {
          closeSidebar(hamburger, sidebar, overlay);
        }
      }, 100);
    });
  }

  // ── Exponer globalmente ───────────────────────────────────────────────────
  // Req 9.2
  window.initResponsiveMenu = initResponsiveMenu;

  // ── Respaldo de arranque ──────────────────────────────────────────────────
  // app-responsive.js actúa como respaldo SOLO si initHamburger() (utils.js)
  // no ha sido llamado todavía. Esto evita duplicar listeners en el SPA.
  function _tryInit() {
    // Si initHamburger ya inicializó el menú, no hacer nada.
    if (window._hamburgerInitialized) return;
    initResponsiveMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _tryInit);
  } else {
    _tryInit();
  }

})();
