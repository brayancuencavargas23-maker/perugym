const Producto = require('../models/Producto');
const Inventario = require('./InventarioService');
const LoteService = require('./LoteService');
const { BusinessError } = require('../middleware/errors/ErrorTypes');

/**
 * Stock Service - Manages inventory operations atomically
 */
class StockService {
  /**
   * Deduct stock atomically
   * @param {ObjectId} productoId - Product ID
   * @param {number} cantidad - Quantity to deduct
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Producto>} - Updated product
   * @throws {BusinessError} - If insufficient stock or product not found
   */
  static async descontarStock(productoId, cantidad, session, context) {
    // Atomic operation: only update if stock is sufficient
    const producto = await Producto.findOneAndUpdate(
      {
        _id: productoId,
        activo: true,
        stock: { $gte: cantidad }
      },
      { $inc: { stock: -cantidad } },
      { new: true, session }
    );

    if (!producto) {
      // Check if product exists or if it's just insufficient stock
      const existe = await Producto.findOne({ _id: productoId, activo: true })
        .select('nombre stock')
        .session(session);
      
      if (!existe) {
        throw new BusinessError('Producto no encontrado o inactivo.');
      }
      throw new BusinessError(
        `Stock insuficiente para "${existe.nombre}". ` +
        `Disponible: ${existe.stock}, solicitado: ${cantidad}.`
      );
    }

    if (context) await Inventario.registrar(producto, producto.stock + cantidad, context, session);
    return producto;
  }

  /**
   * Revert stock atomically
   * @param {ObjectId} productoId - Product ID
   * @param {number} cantidad - Quantity to revert
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Producto>} - Updated product
   */
  static async revertirStock(productoId, cantidad, session, context) {
    const producto = await Producto.findByIdAndUpdate(
      productoId,
      { $inc: { stock: cantidad } },
      { new: true, session }
    );
    if (!producto) throw new BusinessError('Producto no encontrado para devolver existencias.');
    if (context) await Inventario.registrar(producto, producto.stock - cantidad, context, session);
    return producto;
  }

  /**
   * Deduct stock for multiple products in a transaction
   * @param {Array<{producto_id, cantidad}>} items - Items to deduct
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Array<{producto_id, cantidad, precio_unit, subtotal}>>}
   */
  static async descontarMultiple(items, session, context) {
    const resultado = [];

    for (const item of items) {
      const producto = await this.descontarStock(
        item.producto_id,
        item.cantidad,
        session,
        context
      );

      // FEFO: consumir primero el lote más próximo a vencer
      const lotes_consumidos = await LoteService.consumirFEFO(item.producto_id, item.cantidad, session);

      resultado.push({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unit: producto.precio_venta,
        subtotal: producto.precio_venta * item.cantidad,
        lotes_consumidos
      });
    }

    return resultado;
  }

  /**
   * Revert stock for multiple products
   * @param {Array<{producto_id, cantidad}>} items - Items to revert
   * @param {ClientSession} session - Transaction session
   */
  static async revertirMultiple(items, session, context) {
    for (const item of items) {
      await this.revertirStock(item.producto_id, item.cantidad, session, context);
      // Devolver las unidades a los lotes exactos que se consumieron (FEFO)
      if (item.lotes_consumidos?.length) await LoteService.devolverALotes(item.lotes_consumidos, session);
    }
  }
}

module.exports = StockService;
