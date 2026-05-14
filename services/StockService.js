const Producto = require('../models/Producto');
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
  static async descontarStock(productoId, cantidad, session) {
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

    return producto;
  }

  /**
   * Revert stock atomically
   * @param {ObjectId} productoId - Product ID
   * @param {number} cantidad - Quantity to revert
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Producto>} - Updated product
   */
  static async revertirStock(productoId, cantidad, session) {
    return Producto.findByIdAndUpdate(
      productoId,
      { $inc: { stock: cantidad } },
      { new: true, session }
    );
  }

  /**
   * Deduct stock for multiple products in a transaction
   * @param {Array<{producto_id, cantidad}>} items - Items to deduct
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Array<{producto_id, cantidad, precio_unit, subtotal}>>}
   */
  static async descontarMultiple(items, session) {
    const resultado = [];

    for (const item of items) {
      const producto = await this.descontarStock(
        item.producto_id,
        item.cantidad,
        session
      );

      resultado.push({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unit: producto.precio_venta,
        subtotal: producto.precio_venta * item.cantidad
      });
    }

    return resultado;
  }

  /**
   * Revert stock for multiple products
   * @param {Array<{producto_id, cantidad}>} items - Items to revert
   * @param {ClientSession} session - Transaction session
   */
  static async revertirMultiple(items, session) {
    await Promise.all(
      items.map(item => this.revertirStock(item.producto_id, item.cantidad, session))
    );
  }
}

module.exports = StockService;
