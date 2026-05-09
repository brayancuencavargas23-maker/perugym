/**
 * router.js — SPA Router para PeruGym
 *
 * Carga cada gestión via fetch, extrae su contenido y scripts,
 * los inyecta en el shell sin recargar el sidebar.
 *
 * Estrategia para variables globales:
 * - Reescribe let/const → var (var permite redeclaración en scope global)
 * - Limpia con delete las vars de la página anterior antes de ejecutar la nueva
 */

const GymRouter = (() => {

  const ROUTES = {
    dashboard:       '/dashboard.html',
    clientes:        '/clientes.html',
    membresias:      '/membresias.html',
    planes:          '/planes.html',
    pagos:           '/pagos.html',
    asistencia:      '/asistencia.html',
    productos:       '/productos.html',
    caja:            '/caja.html',
    reports:         '/reports.html',
    users:           '/users.html',
    'landing-admin': '/landing-admin.html',
    solicitudes:     '/solicitudes.html',
  };

  // path → page  (para popstate y links internos)
  const PATH_TO_PAGE = Object.fromEntries(
    Object.entries(ROUTES).map(([k, v]) => [v, k])
  );

  let _currentPage  = null;
  let _isNavigating = false;

  // ── Parsear HTML completo → partes relevantes ──────────────────────────────
  function _parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Estilos <style> del <head> propios de la página
    const styles = Array.from(doc.head.querySelectorAll('style'))
      .map(s => s.textContent).join('\n');

    // Contenido de .page-content
    const pc = doc.querySelector('.page-content');
    const content = pc ? pc.innerHTML : '';

    // Modales (fuera de .app-layout)
    const modals = Array.from(doc.querySelectorAll('.modal-overlay'))
      .map(m => m.outerHTML).join('');

    // Scripts del body — filtrar los ya cargados en el shell
    const SHELL_SCRIPTS = [
      '/js/cache.js', '/js/api.js', '/js/utils.js',
      '/js/icons.js', '/js/layout.js', '/js/router.js',
    ];
    
    const allBodyScripts = Array.from(doc.querySelectorAll('body script'));
    console.log('[Router] 🔍 Scripts encontrados en body:', allBodyScripts.length);
    allBodyScripts.forEach((s, i) => {
      console.log(`  Script ${i}:`, {
        src: s.src || 'inline',
        hasContent: !!s.textContent,
        contentLength: s.textContent.length,
        preview: s.textContent.substring(0, 50)
      });
    });
    
    const bodyScripts = allBodyScripts.filter(s => {
        // Saltar solo el script de redirect del head (muy corto y específico)
        if (s.textContent.includes('window.location.replace') && s.textContent.length < 100) {
          console.log('  ⏭️ Saltando script de redirect');
          return false;
        }
        if (!s.src) {
          console.log('  ✅ Script inline aceptado');
          return true;
        }
        const isShellScript = SHELL_SCRIPTS.some(ss => s.src.includes(ss));
        if (isShellScript) {
          console.log(`  ⏭️ Saltando script del shell: ${s.src}`);
        } else {
          console.log(`  ✅ Script externo aceptado: ${s.src}`);
        }
        return !isShellScript;
      });

    console.log('[Router] ✅ Scripts después de filtrar:', bodyScripts.length);

    // Separar externos e inline
    const external = bodyScripts.filter(s => s.src).map(s => s.src);
    const inlines  = bodyScripts.filter(s => !s.src).map(s => s.textContent);

    console.log('[Router] 📄 Parseado:', {
      styles: styles.length + ' chars',
      content: content.length + ' chars',
      modals: modals.length + ' chars',
      external: external.length + ' scripts',
      inlines: inlines.length + ' scripts',
      inlineSizes: inlines.map(i => i.length + ' chars')
    });

    return { styles, content, modals, external, inlines };
  }

  // ── Preparar código inline: envolver en IIFE para aislar scope ────────────
  // Envolvemos todo el código en una función autoejecutable para evitar
  // contaminación del scope global entre navegaciones.
  function _prepareScript(inlines) {
    if (!inlines.length) {
      console.log('[Router] ⚠️ No hay scripts inline para ejecutar');
      return { code: '', vars: [] };
    }

    // Unir y normalizar line endings
    const raw = inlines.join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    console.log('[Router] 📝 Script inline original:', raw.substring(0, 200) + '...');

    // NO detectar variables - las dejaremos en el scope local del IIFE
    const vars = [];

    // Envolver en IIFE para aislar el scope
    // Usamos un try-catch interno para capturar errores sin romper la navegación
    const code = `
(function() {
  'use strict';
  try {
    ${raw}
  } catch (err) {
    console.error('[Page Script] Error en script de página:', err);
  }
})();
`;

    console.log('[Router] ✅ Script preparado y aislado en IIFE');

    return { code, vars };
  }

  // ── Ejecutar un bloque de código JS en el contexto global ─────────────────
  function _runScript(code) {
    console.log('[Router] 🚀 Ejecutando script inline...');
    const s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
    s.remove(); // limpiar del DOM tras ejecución
    console.log('[Router] ✅ Script ejecutado');
  }

  // ── Limpiar recursos de la página anterior ─────────────────────────────────
  function _cleanup() {
    console.log('[Router] 🧹 Limpiando página anterior...');
    
    // Abortar event listeners con signal
    if (window.__spaPageAbort) window.__spaPageAbort.abort();
    window.__spaPageAbort = new AbortController();
    
    // Remover modales de la página anterior
    document.querySelectorAll('.modal-overlay[data-spa-modal]').forEach(m => m.remove());
    
    // Limpiar estilos de la página anterior
    const st = document.getElementById('_spa_styles');
    if (st) st.textContent = '';
    
    console.log('[Router] ✅ Limpieza completada');
  }

  // ── Skeleton de carga ──────────────────────────────────────────────────────
  function _skeleton() {
    const c = document.getElementById('spa-content');
    if (!c) return;
    c.innerHTML = `
      <div style="padding:24px">
        <div style="background:var(--card-bg);border-radius:var(--radius);padding:20px;margin-bottom:20px">
          <div class="skeleton-line title" style="width:35%;height:18px;margin-bottom:10px"></div>
          <div class="skeleton-line" style="width:60%;height:13px"></div>
        </div>
        <div class="card">
          <div style="padding:16px">
            ${Array.from({length:6}).map(() => `
              <div style="display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">
                <div class="skeleton-cell w-70" style="height:13px;flex:2"></div>
                <div class="skeleton-cell w-40" style="height:13px;flex:1"></div>
                <div class="skeleton-cell w-55" style="height:13px;flex:1"></div>
                <div class="skeleton-cell w-30" style="height:13px;flex:1"></div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  // ── Navegación principal ───────────────────────────────────────────────────
  async function navigate(page, push = true) {
    if (_isNavigating || page === _currentPage) return;
    _isNavigating = true;

    console.log(`[Router] 🧭 Navegando a: ${page}`);

    const route = ROUTES[page];
    if (!route) { 
      console.error(`[Router] ❌ Ruta no encontrada: ${page}`);
      _isNavigating = false; 
      return; 
    }

    try {
      // 1. URL
      if (push) history.pushState({ page }, '', route);

      // 2. Sidebar: marcar activo
      document.querySelectorAll('#sidebar .nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.page === page)
      );

      // 3. Título del topbar
      const titleEl = document.querySelector('.topbar h1');
      if (titleEl) {
        const ni = document.querySelector(`#sidebar .nav-item[data-page="${page}"]`);
        if (ni) {
          const clone = ni.cloneNode(true);
          clone.querySelectorAll('.icon,.nav-badge,.nav-badge-admin,.nav-active-dot').forEach(e => e.remove());
          titleEl.textContent = clone.textContent.trim();
        }
      }

      // 4. Limpiar página anterior
      _cleanup();

      // 5. Skeleton
      _skeleton();

      // 6. Fetch HTML
      const res = await fetch(route, { headers: { 'X-SPA-Request': '1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // 7. Parsear
      const { styles, content, modals, external, inlines } = _parse(html);

      // 8. Estilos de página
      let stEl = document.getElementById('_spa_styles');
      if (!stEl) {
        stEl = document.createElement('style');
        stEl.id = '_spa_styles';
        document.head.appendChild(stEl);
      }
      stEl.textContent = styles;

      // 9. Contenido
      const container = document.getElementById('spa-content');
      if (!container) throw new Error('spa-content no encontrado');
      container.innerHTML = content;

      // 10. Modales → body
      if (modals) {
        const tmp = document.createElement('div');
        tmp.innerHTML = modals;
        tmp.querySelectorAll('.modal-overlay').forEach(m => {
          m.setAttribute('data-spa-modal', '1');
          document.body.appendChild(m);
        });
      }

      // 11. Scripts externos (si los hay)
      for (const src of external) {
        await new Promise((resolve, reject) => {
          // Si ya está cargado, no recargar
          if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
          const s = document.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      // 12. Script inline: preparar y ejecutar
      const { code } = _prepareScript(inlines);

      if (code) {
        console.log('[Router] ⏳ Esperando renderizado completo...');
        // Esperar DOS frames para asegurar que el DOM esté completamente renderizado
        await new Promise(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              try {
                _runScript(code);
                console.log('[Router] ✅ Scripts ejecutados correctamente');
                resolve();
              } catch (err) {
                console.error('[Router] ❌ Error ejecutando scripts de', page, err);
                resolve();
              }
            });
          });
        });
      } else {
        console.warn('[Router] ⚠️ No hay código para ejecutar');
      }

      // 13. Actualizar estado
      _currentPage = page;

      // 14. Scroll al inicio
      const mc = document.querySelector('.main-content');
      if (mc) mc.scrollTop = 0;

    } catch (err) {
      console.error('[Router] Error en', page, err);
      window.location.href = route; // fallback
    } finally {
      _isNavigating = false;
    }
  }

  // ── Interceptar sidebar ────────────────────────────────────────────────────
  function _initSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('click', e => {
      const ni = e.target.closest('.nav-item');
      if (!ni) return;
      const page = ni.dataset.page;
      if (!page || !ROUTES[page]) return;
      e.preventDefault();
      navigate(page);
      // Cerrar en móvil
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        document.body.classList.remove('sidebar-open');
        const ov = document.getElementById('sidebar-overlay');
        if (ov) { ov.classList.remove('active'); ov.addEventListener('transitionend', () => ov.classList.remove('visible'), { once: true }); }
        const hb = document.getElementById('hamburger');
        if (hb) { hb.classList.remove('is-open'); hb.setAttribute('aria-expanded', 'false'); }
      }
    });
  }

  // ── Interceptar links internos ─────────────────────────────────────────────
  function _initLinks() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank') return;
      const page = PATH_TO_PAGE[a.getAttribute('href')];
      if (!page) return;
      e.preventDefault();
      navigate(page);
    });
  }

  // ── Botones atrás/adelante ─────────────────────────────────────────────────
  function _initPopState() {
    window.addEventListener('popstate', e => {
      const page = e.state?.page || PATH_TO_PAGE[window.location.pathname];
      if (page) navigate(page, false);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init(initialPage) {
    _initSidebar();
    _initLinks();
    _initPopState();
    history.replaceState({ page: initialPage }, '', ROUTES[initialPage] || window.location.pathname);
    // _currentPage queda null para que navigate() cargue la página inicial
  }

  return { navigate, init, ROUTES };
})();
