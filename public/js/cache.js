/**
 * gymCache — Sistema de caché persistido en sessionStorage
 *
 * Estrategia:
 *  - Primera visita a una gestión → fetch a BD → guarda en sessionStorage
 *  - Visitas siguientes (misma sesión, cualquier página) → sirve desde sessionStorage
 *  - Mutaciones → actualiza caché quirúrgicamente o invalida namespace
 *  - TTL configurable por namespace
 *  - Se limpia automáticamente al cerrar sesión (gymCache.clear())
 *
 * Por qué sessionStorage y no memoria:
 *  - El caché en memoria (Map) se destruye al navegar entre páginas HTML
 *  - sessionStorage persiste durante toda la sesión del browser (misma pestaña)
 *  - Se limpia automáticamente al cerrar la pestaña (sin datos residuales)
 */
const gymCache = (() => {
  // ── Configuración TTL por namespace (ms) ─────────────────────────────────────
  const TTL = {
    default:      5 * 60 * 1000,   // 5 min
    planes:      10 * 60 * 1000,   // 10 min (cambian muy poco)
    clientes:     5 * 60 * 1000,
    membresias:   3 * 60 * 1000,
    pagos:        2 * 60 * 1000,
    productos:    5 * 60 * 1000,
    asistencia:   1 * 60 * 1000,   // muy dinámico
    caja:         1 * 60 * 1000,
    dashboard:    2 * 60 * 1000,
    auth:         5 * 60 * 1000,
    solicitudes:  2 * 60 * 1000,   // leads — actualización frecuente
  };

  const STORAGE_KEY = 'gym_cache';

  // ── Helpers de serialización ─────────────────────────────────────────────────
  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    } catch { return {}; }
  }

  function save(store) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      // sessionStorage lleno: limpiar entradas expiradas y reintentar
      const cleaned = purgeExpired(store);
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned)); } catch {}
    }
  }

  function purgeExpired(store) {
    const now = Date.now();
    const result = {};
    for (const [key, entry] of Object.entries(store)) {
      const ttl = TTL[entry.namespace] ?? TTL.default;
      if (now - entry.ts <= ttl) result[key] = entry;
    }
    return result;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function namespace(path) {
    const seg = path.replace(/^\//, '').split(/[/?]/)[0];
    return seg || 'default';
  }

  function ttlFor(ns) {
    return TTL[ns] ?? TTL.default;
  }

  function isExpired(entry) {
    return Date.now() - entry.ts > ttlFor(entry.namespace);
  }

  // ── API pública ──────────────────────────────────────────────────────────────

  /** Lee una entrada del caché. Devuelve null si no existe o expiró. */
  function get(path) {
    const store = load();
    const entry = store[path];
    if (!entry) return null;
    if (isExpired(entry)) {
      delete store[path];
      save(store);
      return null;
    }
    return entry.data;
  }

  /** Guarda una respuesta en caché. */
  function set(path, data) {
    const store = load();
    const ns = namespace(path);
    store[path] = { data, ts: Date.now(), namespace: ns };
    save(store);
  }

  /**
   * Invalida todas las entradas cuyo namespace coincida.
   * Ejemplo: invalidate('clientes') borra /clientes, /clientes?page=2, etc.
   */
  function invalidate(ns) {
    const store = load();
    let changed = false;
    for (const key of Object.keys(store)) {
      if (namespace(key) === ns) { delete store[key]; changed = true; }
    }
    if (changed) save(store);
  }

  /** Invalida múltiples namespaces a la vez. */
  function invalidateMany(namespaces) {
    const store = load();
    let changed = false;
    for (const key of Object.keys(store)) {
      if (namespaces.includes(namespace(key))) { delete store[key]; changed = true; }
    }
    if (changed) save(store);
  }

  /** Borra todo el caché (al cerrar sesión). */
  function clear() {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Actualiza quirúrgicamente un ítem dentro de una respuesta cacheada.
   * Busca en todas las entradas del namespace y aplica el patcher sobre el ítem con el id dado.
   */
  function patchItem(ns, id, patcher) {
    const store = load();
    let changed = false;

    for (const [key, entry] of Object.entries(store)) {
      if (namespace(key) !== ns) continue;
      if (isExpired(entry)) { delete store[key]; changed = true; continue; }

      const data = entry.data;

      // Respuesta paginada: { data: [...], total, page, pages }
      if (data && Array.isArray(data.data)) {
        const idx = data.data.findIndex(x => (x._id || x.id) === id);
        if (idx !== -1) {
          const updated = [...data.data];
          updated[idx] = patcher(updated[idx]);
          store[key] = { ...entry, data: { ...data, data: updated } };
          changed = true;
        }
      }

      // Respuesta array plana: [...]
      if (Array.isArray(data)) {
        const idx = data.findIndex(x => (x._id || x.id) === id);
        if (idx !== -1) {
          const updated = [...data];
          updated[idx] = patcher(updated[idx]);
          store[key] = { ...entry, data: updated };
          changed = true;
        }
      }
    }

    if (changed) save(store);
  }

  /**
   * Elimina quirúrgicamente un ítem del caché sin invalidar toda la gestión.
   */
  function removeItem(ns, id) {
    const store = load();
    let changed = false;

    for (const [key, entry] of Object.entries(store)) {
      if (namespace(key) !== ns) continue;
      if (isExpired(entry)) { delete store[key]; changed = true; continue; }

      const data = entry.data;

      if (data && Array.isArray(data.data)) {
        const filtered = data.data.filter(x => (x._id || x.id) !== id);
        if (filtered.length !== data.data.length) {
          store[key] = { ...entry, data: { ...data, data: filtered, total: (data.total || 1) - 1 } };
          changed = true;
        }
      }

      if (Array.isArray(data)) {
        const filtered = data.filter(x => (x._id || x.id) !== id);
        if (filtered.length !== data.length) {
          store[key] = { ...entry, data: filtered };
          changed = true;
        }
      }
    }

    if (changed) save(store);
  }

  /**
   * Prepend de un ítem nuevo en la primera página cacheada de un namespace.
   */
  function prependItem(ns, item) {
    const store = load();
    let changed = false;

    for (const [key, entry] of Object.entries(store)) {
      if (namespace(key) !== ns) continue;
      if (isExpired(entry)) { delete store[key]; changed = true; continue; }

      const data = entry.data;
      const isPage1 = !key.includes('page=') || key.includes('page=1');

      if (data && Array.isArray(data.data) && isPage1) {
        store[key] = { ...entry, data: { ...data, data: [item, ...data.data], total: (data.total || 0) + 1 } };
        changed = true;
      }

      if (Array.isArray(data)) {
        store[key] = { ...entry, data: [item, ...data] };
        changed = true;
      }
    }

    if (changed) save(store);
  }

  /** Devuelve estadísticas del caché (útil para debug en consola). */
  function stats() {
    const store = load();
    return Object.entries(store).map(([key, entry]) => ({
      key,
      namespace: entry.namespace,
      age: Math.round((Date.now() - entry.ts) / 1000) + 's',
      expired: isExpired(entry),
      size: JSON.stringify(entry.data).length + ' chars',
    }));
  }

  return { get, set, invalidate, invalidateMany, clear, patchItem, removeItem, prependItem, stats, namespace };
})();
