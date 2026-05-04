const API_BASE = '/api';

const api = {
  getToken: () => localStorage.getItem('gym_token'),

  headers(isFormData = false) {
    const h = { Authorization: `Bearer ${this.getToken()}` };
    if (!isFormData) h['Content-Type'] = 'application/json';
    return h;
  },

  // ── Núcleo HTTP ──────────────────────────────────────────────────────────────
  async request(method, path, body = null, isFormData = false) {
    const opts = { method, headers: this.headers(isFormData) };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);

    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401) {
      // Token inválido o expirado → forzar logout
      gymCache.clear();
      localStorage.removeItem('gym_token');
      localStorage.removeItem('gym_user');
      window.location.href = '/login.html';
      return;
    }
    if (res.status === 403) {
      // Autenticado pero sin permiso → lanzar error sin cerrar sesión
      throw new Error('No tienes permiso para realizar esta acción');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
    return data;
  },

  // ── GET con caché ────────────────────────────────────────────────────────────
  /**
   * Primero busca en caché. Si hay hit válido lo devuelve sin tocar la BD.
   * Si no hay hit (primera visita o TTL expirado) hace fetch y guarda el resultado.
   *
   * @param {string}  path          - ruta relativa, ej: '/clientes?page=1'
   * @param {boolean} [force=false] - true para saltarse el caché y forzar fetch
   */
  async get(path, force = false) {
    if (!force) {
      const cached = gymCache.get(path);
      if (cached !== null) return cached;
    }
    const data = await this.request('GET', path);
    if (data !== undefined) gymCache.set(path, data);
    return data;
  },

  // ── POST ─────────────────────────────────────────────────────────────────────
  /**
   * Ejecuta el POST y luego aplica la estrategia de caché indicada.
   *
   * @param {string}  path
   * @param {object}  body
   * @param {boolean} isFormData
   * @param {object}  [cacheOpts]  - opciones de actualización de caché
   *   cacheOpts.invalidate  {string[]}  namespaces a invalidar completamente
   *   cacheOpts.prepend     {string}    namespace donde hacer prepend del resultado
   */
  async post(path, body, isFormData, cacheOpts) {
    const data = await this.request('POST', path, body, isFormData);
    if (data !== undefined) api._applyCacheOpts('post', path, data, cacheOpts);
    return data;
  },

  // ── PUT ──────────────────────────────────────────────────────────────────────
  /**
   * Ejecuta el PUT y actualiza el ítem en caché quirúrgicamente.
   *
   * @param {string}  path
   * @param {object}  body
   * @param {object}  [cacheOpts]
   *   cacheOpts.patch       { ns, id }  actualiza el ítem en el namespace
   *   cacheOpts.invalidate  {string[]}  namespaces a invalidar completamente
   */
  async put(path, body, cacheOpts) {
    const data = await this.request('PUT', path, body);
    if (data !== undefined) api._applyCacheOpts('put', path, data, cacheOpts);
    return data;
  },

  // ── DELETE ───────────────────────────────────────────────────────────────────
  /**
   * Ejecuta el DELETE y elimina el ítem del caché quirúrgicamente.
   *
   * @param {string}  path
   * @param {object}  [cacheOpts]
   *   cacheOpts.remove      { ns, id }  elimina el ítem del namespace
   *   cacheOpts.invalidate  {string[]}  namespaces a invalidar completamente
   */
  async delete(path, cacheOpts) {
    const data = await this.request('DELETE', path);
    if (data !== undefined) api._applyCacheOpts('delete', path, data, cacheOpts);
    return data;
  },

  // ── Descarga de archivos (sin caché) ─────────────────────────────────────────
  download: async (path, filename) => {
    const res = await fetch(API_BASE + path, { headers: api.headers() });

    // Si el servidor devuelve error, leerlo como JSON y lanzar el mensaje
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Error ${res.status} al generar el reporte`);
    }

    const blob = await res.blob();

    // Verificar que el blob tenga contenido real (no un JSON de error disfrazado)
    if (blob.size === 0) {
      throw new Error('El archivo generado está vacío');
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ── Motor interno de estrategias de caché ────────────────────────────────────
  _applyCacheOpts(method, path, responseData, opts) {
    if (!opts) {
      // Sin opciones explícitas: inferir namespace del path y invalidar
      const ns = gymCache.namespace(path.replace(/^\//, '').split(/[/?]/)[0]);
      gymCache.invalidate(ns);
      return;
    }

    // Invalidación completa de namespaces
    if (opts.invalidate && opts.invalidate.length) {
      gymCache.invalidateMany(opts.invalidate);
    }

    // Actualización quirúrgica de un ítem existente
    if (opts.patch && responseData) {
      const { ns, id } = opts.patch;
      gymCache.patchItem(ns, id, () => responseData);
    }

    // Prepend de un ítem nuevo en la lista cacheada
    if (opts.prepend && responseData) {
      gymCache.prependItem(opts.prepend, responseData);
    }

    // Eliminación quirúrgica de un ítem
    if (opts.remove) {
      const { ns, id } = opts.remove;
      gymCache.removeItem(ns, id);
    }
  },
};
