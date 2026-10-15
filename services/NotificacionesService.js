const { createHash } = require('crypto');
const Membresia = require('../models/Membresia');
const Pago = require('../models/Pago');
const Producto = require('../models/Producto');
const Lote = require('../models/Lote');
const Solicitud = require('../models/Solicitud');
const Leida = require('../models/NotificacionLeida');
const { DAY, limaDate, parseDate } = require('../utils/reportDates');
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const claveSolicitud = id => `solicitud:${id}`;

async function listar(usuarioId, now = new Date()) {
  const today = parseDate(limaDate(now));
  const tomorrow = new Date(+today + DAY);
  const in3 = new Date(+today + 4 * DAY);
  const in30 = new Date(+today + 31 * DAY);
  const [membresias, pagos, productos, solicitudes, lotes] = await Promise.all([
    Membresia.find({ estado: 'activo', fecha_fin: { $gte: now, $lt: in3 } })
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno').populate('plan_id', 'nombre').lean(),
    Pago.find({ estado: 'pendiente' }).select('_id monto').sort({ _id: 1 }).lean(),
    Producto.find({ activo: true, $expr: { $lte: ['$stock', { $ifNull: ['$stock_minimo', 5] }] } }).select('nombre stock stock_minimo precio_venta categoria updatedAt').sort({ stock: 1 }).lean(),
    Solicitud.find({ estado: 'pendiente' }).select('nombre telefono created_at').populate('plan_id', 'nombre')
      .sort({ created_at: -1 }).limit(20).lean(),
    Lote.find({ fecha_vencimiento: { $lt: in30 } }).populate('producto_id', 'nombre')
      .select('numero_lote cantidad fecha_vencimiento producto_id').sort({ fecha_vencimiento: 1 }).limit(20).lean(),
  ]);
  const items = membresias.map(m => {
    const hoy = m.fecha_fin < tomorrow;
    const tipo = hoy ? 'vencimiento_hoy' : 'vencimiento_proximo';
    const nombre = [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno, m.cliente_id?.apellido_materno].filter(Boolean).join(' ');
    const dias = Math.round((parseDate(limaDate(m.fecha_fin)) - today) / DAY);
    return { clave: key(tipo, m._id, m.fecha_fin), tipo,
      titulo: `${nombre} — ${hoy ? 'vence hoy' : `vence en ${dias}d`}`,
      detalle: m.plan_id?.nombre || '', prioridad: hoy ? 'alta' : 'media' };
  });
  if (pagos.length) items.push({ clave: key('pagos', pagos.map(p => [p._id, p.monto])),
    tipo: 'pagos_pendientes', titulo: `${pagos.length} pagos pendientes`, detalle: 'Requieren atención', prioridad: 'media' });
  productos.forEach(p => items.push({ clave: key('stock', p._id, p.stock, p.updatedAt),
    tipo: 'stock_bajo', titulo: p.nombre, detalle: `Stock: ${p.stock} — S/.${(p.precio_venta || 0).toFixed(2)}`,
    prioridad: p.stock === 0 ? 'alta' : 'baja', producto: p }));
  solicitudes.forEach(s => items.push({ clave: claveSolicitud(s._id), tipo: 'nueva_solicitud',
    titulo: `Nueva solicitud — ${s.nombre}`, detalle: s.plan_id?.nombre || s.telefono,
    prioridad: 'alta' }));
  lotes.forEach(l => {
    const nombre = l.producto_id?.nombre || 'Producto sin nombre';
    const dias = Math.round((parseDate(limaDate(l.fecha_vencimiento)) - today) / DAY);
    const vencido = dias < 0;
    const fechaTxt = limaDate(l.fecha_vencimiento);
    items.push({ clave: key('lote', vencido ? 'vencido' : 'por_vencer', l._id, l.fecha_vencimiento),
      tipo: vencido ? 'lote_vencido' : 'lote_por_vencer',
      titulo: `${nombre} — ${vencido ? `lote vencido hace ${Math.abs(dias)}d` : `lote vence en ${dias}d`}`,
      detalle: `Lote ${l.numero_lote || 's/n'} · ${l.cantidad} u. · ${fechaTxt}`,
      prioridad: vencido ? 'alta' : 'media' });
  });
  const order = { alta: 0, media: 1, baja: 2 };
  items.sort((a, b) => order[a.prioridad] - order[b.prioridad]);
  const leidas = new Set((await Leida.find({ usuario_id: String(usuarioId), clave: { $in: items.map(n => n.clave) } }).select('clave').lean()).map(n => n.clave));
  items.forEach(n => { n.leida = leidas.has(n.clave); });
  return { total: items.length, no_leidas: items.filter(n => !n.leida).length, items };
}

async function marcarClaves(usuarioId, claves) {
  if (!claves.length) return;
  await Leida.init();
  try {
    await Leida.bulkWrite([...new Set(claves)].map(clave => ({ updateOne: {
      filter: { usuario_id: String(usuarioId), clave },
      update: { $setOnInsert: { leida_en: new Date() } }, upsert: true,
    } })), { ordered: false });
  } catch (err) {
    // Dos pestañas pueden marcar la misma clave simultáneamente.
    if (err.code !== 11000 || err.writeErrors?.some(e => e.code !== 11000)) throw err;
  }
}

async function solicitudesNoLeidas(usuarioId, ids) {
  const claves = ids.map(claveSolicitud);
  if (!claves.length) return 0;
  const leidas = await Leida.countDocuments({ usuario_id: String(usuarioId), clave: { $in: claves } });
  return claves.length - leidas;
}

async function marcarLeidas(usuarioId, claves) {
  await marcarClaves(usuarioId, claves);
  return listar(usuarioId);
}

module.exports = { listar, marcarLeidas, marcarClaves, solicitudesNoLeidas, claveSolicitud };
