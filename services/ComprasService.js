const mongoose = require('mongoose');
const Producto = require('../models/Producto');
const Compra = require('../models/Compra');
const Proveedor = require('../models/Proveedor');
const Movimiento = require('../models/MovimientoInventario');
const Lote = require('../models/Lote');
const TransactionManager = require('../utils/TransactionManager');
const { parseDate } = require('../utils/reportDates');

function error(message, status = 400) { return Object.assign(new Error(message), { status }); }

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw error('Agrega al menos un producto a la compra.');
  if (items.length > 50) throw error('Una compra puede incluir hasta 50 productos.');
  const vistos = new Set();
  items.forEach((item, i) => {
    const n = i + 1;
    if (!item || !mongoose.Types.ObjectId.isValid(String(item.producto_id))) throw error(`Producto inválido en el item ${n}.`);
    const key = String(item.producto_id);
    if (vistos.has(key)) throw error('Un producto no puede repetirse en la compra: indica las unidades totales.');
    vistos.add(key);
    if (!Number.isSafeInteger(item.cantidad) || item.cantidad < 1) throw error(`Cantidad inválida en el item ${n} (entero mayor a 0).`);
    if (!Number.isFinite(Number(item.costo_unit)) || Number(item.costo_unit) < 0) throw error(`Costo inválido en el item ${n}.`);
    if (item.fecha_vencimiento) {
      let d;
      try { d = /^\d{4}-\d{2}-\d{2}$/.test(item.fecha_vencimiento) ? parseDate(item.fecha_vencimiento) : new Date(item.fecha_vencimiento); }
      catch { throw error(`Fecha de vencimiento inválida en el item ${n}.`); }
      if (isNaN(d.getTime())) throw error(`Fecha de vencimiento inválida en el item ${n}.`);
    }
    if (item.numero_lote != null && (typeof item.numero_lote !== 'string' || item.numero_lote.length > 40)) {
      throw error(`Número de lote inválido en el item ${n}.`);
    }
  });
}

/**
 * Costo promedio ponderado: (stock_actual × costo_actual + unidades × costo_compra) / unidades_totales.
 * Si el stock está en 0, el nuevo costo pasa a ser el de la compra.
 */
function costoPromedio(stockActual, costoActual, cantidad, costoCompra) {
  const unidades = stockActual + cantidad;
  if (unidades <= 0) return round2(costoCompra);
  return round2((stockActual * (costoActual || 0) + cantidad * costoCompra) / unidades);
}

/**
 * Registra una compra: aumenta stock, actualiza costo (promedio ponderado),
 * escribe los movimientos de inventario y crea el documento de compra.
 * Todo dentro de una transacción (o con compensación si no hay sesión).
 */
async function registrar({ proveedor_id, items, notas, fecha }, user) {
  validarItems(items);
  if (notas != null && (typeof notas !== 'string' || notas.length > 500)) throw error('Notas inválidas (máximo 500 caracteres).');
  let fechaCompra = new Date();
  if (fecha) {
    let d;
    try { d = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? parseDate(fecha) : new Date(fecha); }
    catch { throw error('Fecha inválida.'); }
    if (isNaN(d.getTime())) throw error('Fecha inválida.');
    fechaCompra = d;
  }

  return TransactionManager.execute(async session => {
    const ids = items.map(i => i.producto_id);
    const productos = await Producto.find({ _id: { $in: ids } })
      .sort({ _id: 1 })
      .session(session);

    const porId = new Map(productos.map(p => [String(p._id), p]));
    const proveedor = proveedor_id
      ? await Proveedor.findById(proveedor_id).session(session)
      : null;
    if (proveedor_id && !proveedor) throw error('El proveedor indicado no existe.', 404);

    // Snapshot de los items con el nombre real del producto
    const itemsCompra = items.map(item => {
      const p = porId.get(String(item.producto_id));
      if (!p) throw error('Uno de los productos no existe.', 404);
      if (!p.activo) throw error(`El producto "${p.nombre}" está inactivo. Actívalo antes de comprarlo.`);
      const costo = round2(Number(item.costo_unit));
      return {
        producto_id: p._id,
        nombre: p.nombre,
        cantidad: item.cantidad,
        costo_unit: costo,
        subtotal: round2(item.cantidad * costo),
        fecha_vencimiento: item.fecha_vencimiento ? (/^\d{4}-\d{2}-\d{2}$/.test(item.fecha_vencimiento)
          ? parseDate(item.fecha_vencimiento) : new Date(item.fecha_vencimiento)) : null,
        numero_lote: item.numero_lote ? String(item.numero_lote).trim() || null : null,
      };
    });

    const costoTotal = round2(itemsCompra.reduce((s, it) => s + it.subtotal, 0));

    const [compra] = await Compra.create([{
      proveedor_id: proveedor ? proveedor._id : null,
      proveedor_nombre: proveedor ? proveedor.nombre : null,
      fecha: fechaCompra,
      items: itemsCompra,
      costo_total: costoTotal,
      notas: notas ? String(notas).trim() || null : null,
      usuario_id: String(user.id),
      responsable: user.name || user.email || String(user.id),
    }], { session });

    const motivo = `Compra${proveedor ? ' a ' + proveedor.nombre : ''}`;
    const actualizados = [];
    const movimientos = [];
    const lotes = [];
    try {
      for (const it of itemsCompra) {
        const p = porId.get(String(it.producto_id));
        const nuevoStock = p.stock + it.cantidad;
        const nuevoCosto = costoPromedio(p.stock, p.costo, it.cantidad, it.costo_unit);

        const upd = await Producto.findOneAndUpdate(
          { _id: p._id, activo: true, stock: p.stock },
          { $set: { stock: nuevoStock, costo: nuevoCosto } },
          { new: true, session }
        );
        if (!upd) throw error('El stock de un producto cambió mientras registrabas la compra. Reintenta.', 409);
        actualizados.push({ _id: p._id, stock: p.stock, costo: p.costo || 0 });

        const [mov] = await Movimiento.create([{
          producto_id: p._id,
          stock_anterior: p.stock,
          stock_nuevo: nuevoStock,
          cantidad: it.cantidad,
          tipo: 'entrada',
          motivo,
          usuario_id: String(user.id),
          responsable: user.name || user.email || String(user.id),
          compra_id: compra._id,
        }], { session });
        movimientos.push(mov._id);

        // Trazabilidad: si el item trae vencimiento, registrar el lote
        if (it.fecha_vencimiento) {
          const [lote] = await Lote.create([{
            producto_id: p._id,
            numero_lote: it.numero_lote,
            cantidad: it.cantidad,
            fecha_vencimiento: it.fecha_vencimiento,
            compra_id: compra._id,
            proveedor_nombre: proveedor ? proveedor.nombre : null,
            usuario_id: String(user.id),
            responsable: user.name || user.email || String(user.id),
          }], { session });
          lotes.push(lote._id);
        }
      }
    } catch (err) {
      if (!session) {
        // Sin transacción: compensar lo ya aplicado
        for (const a of actualizados) {
          await Producto.updateOne({ _id: a._id }, { $set: { stock: a.stock, costo: a.costo } });
        }
        await Movimiento.deleteMany({ _id: { $in: movimientos } });
        await Lote.deleteMany({ _id: { $in: lotes } });
        await Compra.deleteOne({ _id: compra._id });
      }
      throw err;
    }

    return compra;
  });
}

/** Valorización del inventario activo: Σ stock × costo. */
async function valorizacion() {
  const [r] = await Producto.aggregate([
    { $match: { activo: true } },
    { $group: { _id: null, valor: { $sum: { $multiply: ['$stock', { $ifNull: ['$costo', 0] }] } }, unidades: { $sum: '$stock' } } },
  ]);
  return { valorizacion: round2(r ? r.valor : 0), unidades: r ? r.unidades : 0 };
}

module.exports = { registrar, valorizacion, costoPromedio, round2 };
