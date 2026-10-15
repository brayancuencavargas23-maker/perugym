const Producto = require('../models/Producto');
const Movimiento = require('../models/MovimientoInventario');
const TransactionManager = require('../utils/TransactionManager');

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
  return TransactionManager.execute(async session => {
    const actual = await Producto.findById(id).session(session);
    if (!actual) throw error('Producto no encontrado.', 404);
    if (!actual.activo) throw error('Activa el producto antes de modificar sus existencias.');
    if (body.tipo === 'ajuste' && body.stock_anterior !== actual.stock) throw error('El stock cambió. Actualiza el producto y repite el conteo.', 409);
    const nuevo = body.tipo === 'entrada' ? actual.stock + valor : valor;
    if (!Number.isSafeInteger(nuevo) || nuevo === actual.stock) throw error('El movimiento debe cambiar el stock dentro del rango permitido.');
    const producto = await Producto.findOneAndUpdate({ _id: id, stock: actual.stock, activo: true }, { $set: { stock: nuevo } }, { new: true, session });
    if (!producto) throw error('El stock cambió. Actualiza e inténtalo de nuevo.', 409);
    try {
      await registrar(producto, actual.stock, { ...body, motivo: body.motivo.trim(), user }, session);
    } catch (err) {
      if (!session) await Producto.updateOne({ _id: id }, { $inc: { stock: actual.stock - nuevo } });
      throw err;
    }
    return producto;
  });
}

module.exports = { registrar, modificar };
