const Lote = require('../models/Lote');

/**
 * Consumo FEFO (First-Expired-First-Out).
 *
 * El stock del producto (Producto.stock) es la fuente de verdad para la
 * disponibilidad. Aquí solo sincronizamos las cantidades de cada lote para
 * que la venta consuma primero el lote más próximo a vencer.
 *
 * Devuelve el detalle [{ lote_id, cantidad }] de lo consumido, para poder
 * revertirlo exactamente al anular la venta.
 *
 * Si los lotes no cubren la cantidad total (existencias que entraron sin
 * lote), el resto sale de stock "no trazado": no es un error.
 */
async function consumirFEFO(productoId, cantidad, session) {
  const lotes = await Lote.find({ producto_id: productoId, cantidad: { $gt: 0 } })
    .sort({ fecha_vencimiento: 1, _id: 1 }) // FEFO: vence primero sale primero
    .session(session);

  const detalle = [];
  let pendiente = cantidad;

  for (const lote of lotes) {
    if (pendiente <= 0) break;
    const tomar = Math.min(lote.cantidad, pendiente);
    // Decremento atómico con candado: nunca dejar el lote en negativo.
    const actualizado = await Lote.findOneAndUpdate(
      { _id: lote._id, cantidad: { $gte: tomar } },
      { $inc: { cantidad: -tomar } },
      { new: true, session }
    );
    if (actualizado) {
      detalle.push({ lote_id: lote._id, cantidad: tomar });
      pendiente -= tomar;
    }
  }
  return detalle;
}

/**
 * Devuelve unidades a los lotes de origen (anulación de venta).
 * Recibe el detalle [{ lote_id, cantidad }] que guardó la venta.
 */
async function devolverALotes(detalle, session) {
  for (const d of detalle || []) {
    if (!d || !d.lote_id || !Number.isSafeInteger(d.cantidad) || d.cantidad <= 0) continue;
    await Lote.updateOne({ _id: d.lote_id }, { $inc: { cantidad: d.cantidad } }, { session });
  }
}

module.exports = { consumirFEFO, devolverALotes };
