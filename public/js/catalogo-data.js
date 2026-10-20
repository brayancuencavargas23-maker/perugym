// Datos compartidos por los módulos del catálogo (Productos, Inventario), sin conservar copias del catálogo.
window.GymCatalogo = (() => {
  async function listar(path, signal) {
    const [base, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    params.set('limit', '500');
    const registros = new Map();
    let page = 1;
    let pages = 1;
    do {
      if (signal?.aborted) throw new DOMException('Navegación cancelada', 'AbortError');
      params.set('page', String(page));
      const result = await api.get(base + '?' + params, true);
      if (signal?.aborted) throw new DOMException('Navegación cancelada', 'AbortError');
      for (const item of result.data) registros.set(String(item._id || item.id), item);
      pages = Math.max(1, Number(result.pages) || 1);
      page++;
    } while (page <= pages);
    return [...registros.values()];
  }

  function invalidar() {
    gymCache.invalidateMany(['productos', 'inventario', 'dashboard', 'reports']);
  }

  function hoy() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  return { listar, invalidar, hoy };
})();
