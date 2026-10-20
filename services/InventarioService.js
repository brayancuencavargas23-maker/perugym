const Producto = require('../models/Producto');
const Movimiento = require('../models/MovimientoInventario');
const Lote = require('../models/Lote');
const TransactionManager = require('../utils/TransactionManager');
const { parseDate } = require('../utils/reportDates');

function error(message, status = 400) { return Object.assign(new Error(message), { status }); }

async function registrar(producto, anterior, context, session) {
  const [movimiento] = await Movimiento.create([{
    producto_id: producto._id, stock_anterior: anterior, stock_nuevo: producto.stock,
    cantidad: producto.stock - anterior, tipo: context.tipo, motivo: context.motivo,
    usuario_id: String(context.user.id), responsable: context.user.name || context.user.email || String(context.user.id),
    venta_id: context.venta_id || null, compra_id: context.compra_id || null
  }], { session });
  return movimiento;
}

async function modificar(id, body, user) {
  if (!['entrada', 'ajuste'].includes(body.tipo)) throw error('Tipo de movimiento inválido.');
  if (typeof body.motivo !== 'string' || !body.motivo.trim() || body.motivo.length > 500) throw error('Indica un motivo (máximo 500 caracteres).');
  const valor = body.tipo === 'entrada' ? body.cantidad : body.stock_nuevo;
  if (!Number.isSafeInteger(valor) || valor < (body.tipo === 'entrada' ? 1 : 0)) throw error('La cantidad debe ser un entero válido.');

  // ── Opcionales de entrada: precio de compra (costo) y lote con vencimiento ──
  let costo = null;
  if (body.costo !== undefined && body.costo !== null && body.costo !== '') {
    if (!Number.isFinite(Number(body.costo)) || Number(body.costo) < 0) throw error('El precio de compra (costo) debe ser un número mayor o igual a 0.');
    costo = Number(body.costo);
  }
  let fechaLote = null;
  let numeroLote = null;
  if (body.fecha_vencimiento) {
    try {
      fechaLote = /^\d{4}-\d{2}-\d{2}$/.test(body.fecha_vencimiento) ? parseDate(body.fecha_vencimiento) : new Date(body.fecha_vencimiento);
    } catch { throw error('Indica una fecha de vencimiento válida.'); }
    if (isNaN(fechaLote.getTime())) throw error('Indica una fecha de vencimiento válida.');
  }
  if (body.numero_lote !== undefined && body.numero_lote !== null && body.numero_lote !== '') {
    if (typeof body.numero_lote !== 'string' || body.numero_lote.length > 40) throw error('Número de lote inválido (máximo 40 caracteres).');
    numeroLote = body.numero_lote.trim() || null;
  }
  // El costo y el lote solo aplican a entradas, no a ajustes de conteo
  if (body.tipo !== 'entrada' && (costo !== null || fechaLote || numeroLote)) {
    throw error('El precio de compra y el lote solo aplican a entradas.');
  }
  if (numeroLote && !fechaLote) throw error('Para registrar un lote indica también su fecha de vencimiento.');

  return TransactionManager.execute(async session => {
    const actual = await Producto.findById(id).session(session);
    if (!actual) throw error('Producto no encontrado.', 404);
    if (!actual.activo) throw error('Activa el producto antes de modificar sus existencias.');
    if (body.tipo === 'ajuste' && body.stock_anterior !== actual.stock) throw error('El stock cambió. Actualiza el producto y repite el conteo.', 409);
    const nuevo = body.tipo === 'entrada' ? actual.stock + valor : valor;
    if (!Number.isSafeInteger(nuevo) || nuevo === actual.stock) throw error('El movimiento debe cambiar el stock dentro del rango permitido.');

    // La entrada puede actualizar también el costo del producto
    const setUpdate = { stock: nuevo };
    if (costo !== null) setUpdate.costo = costo;

    const producto = await Producto.findOneAndUpdate(
      { _id: id, stock: actual.stock, activo: true },
      { $set: setUpdate },
      { new: true, session }
    );
    if (!producto) throw error('El stock cambió. Actualiza e inténtalo de nuevo.', 409);

    let lote = null;
    try {
      await registrar(producto, actual.stock, { ...body, motivo: body.motivo.trim(), user }, session);
      // Trazabilidad: si la entrada trae vencimiento, crear el lote en el mismo paso
      if (fechaLote) {
        [lote] = await Lote.create([{
          producto_id: producto._id,
          numero_lote: numeroLote,
          cantidad: valor,
          fecha_vencimiento: fechaLote,
          usuario_id: String(user.id),
          responsable: user.name || user.email || String(user.id),
        }], { session });
      }
    } catch (err) {
      if (!session) {
        // Sin transacción: compensar stock y costo ya aplicados
        await Producto.updateOne({ _id: id }, { $set: { stock: actual.stock, costo: actual.costo || 0 } });
        if (lote?._id) await Lote.deleteOne({ _id: lote._id });
      }
      throw err;
    }
    return { ...producto.toObject(), lote_creado: lote ? true : false };
  });
}

module.exports = { registrar, modificar };
