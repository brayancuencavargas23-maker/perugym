function categoriaProducto(producto) {
  if (!producto) return 'Producto no disponible';
  const categoria = typeof producto.categoria === 'string' ? producto.categoria.trim().replace(/\s+/g, ' ') : '';
  if (!categoria) return 'Sin categoría';
  return categoria.toLocaleLowerCase('es-PE').replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toLocaleUpperCase('es-PE'));
}

module.exports = { categoriaProducto };
