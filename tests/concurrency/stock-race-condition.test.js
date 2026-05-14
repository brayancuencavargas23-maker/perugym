const mongoose = require('mongoose');
const Producto = require('../../models/Producto');
const StockService = require('../../services/StockService');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');

describe('Stock Race Conditions', () => {
  beforeAll(async () => await setupTestDB(), 60000);
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  it('should prevent overselling with concurrent operations', async () => {
    // Arrange: Product with limited stock
    const producto = await Producto.create({
      nombre: 'Producto Limitado',
      precio_venta: 100,
      stock: 5,
      activo: true
    });

    // Act: 10 users try to buy 1 unit simultaneously
    const compras = Array(10).fill(null).map(() =>
      mongoose.startSession().then(async session => {
        try {
          session.startTransaction();
          const result = await StockService.descontarStock(producto._id, 1, session);
          await session.commitTransaction();
          return { success: true, result };
        } catch (error) {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
          return { success: false, error: error.message };
        } finally {
          session.endSession();
        }
      })
    );

    const resultados = await Promise.all(compras);

    // Assert: Some should succeed, some should fail
    const exitosas = resultados.filter(r => r.success);
    const fallidas = resultados.filter(r => !r.success);

    // At least some operations should succeed
    expect(exitosas.length).toBeGreaterThan(0);
    // At least some operations should fail (because we're trying to buy more than available)
    expect(fallidas.length).toBeGreaterThan(0);
    // Total should be 10
    expect(exitosas.length + fallidas.length).toBe(10);

    // Verify final stock is never negative
    const productoFinal = await Producto.findById(producto._id);
    expect(productoFinal.stock).toBeGreaterThanOrEqual(0);
    // Stock should be reduced by the number of successful operations
    expect(productoFinal.stock).toBe(5 - exitosas.length);
  });

  it('should never allow negative stock under any circumstance', async () => {
    const producto = await Producto.create({
      nombre: 'Test Product',
      precio_venta: 50,
      stock: 1,
      activo: true
    });

    // Try to sell 2 units when only 1 is available
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await expect(
        StockService.descontarStock(producto._id, 2, session)
      ).rejects.toThrow('Stock insuficiente');

      await session.abortTransaction();
    } finally {
      session.endSession();
    }

    // Verify stock is still 1
    const p = await Producto.findById(producto._id);
    expect(p.stock).toBe(1);
  });

  it('should handle concurrent sales of different products correctly', async () => {
    const producto1 = await Producto.create({
      nombre: 'Producto A',
      precio_venta: 100,
      stock: 3,
      activo: true
    });

    const producto2 = await Producto.create({
      nombre: 'Producto B',
      precio_venta: 80,
      stock: 3,
      activo: true
    });

    // 6 concurrent sales: 3 for product A, 3 for product B
    const ventas = [
      ...Array(3).fill(producto1._id),
      ...Array(3).fill(producto2._id)
    ].map(productoId =>
      mongoose.startSession().then(async session => {
        try {
          session.startTransaction();
          const result = await StockService.descontarStock(productoId, 1, session);
          await session.commitTransaction();
          return { success: true, productoId };
        } catch (error) {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
          return { success: false, productoId, error: error.message };
        } finally {
          session.endSession();
        }
      })
    );

    const resultados = await Promise.all(ventas);

    // At least some should succeed
    const exitosas = resultados.filter(r => r.success);
    expect(exitosas.length).toBeGreaterThan(0);

    // Verify final stock for both products is never negative
    const p1 = await Producto.findById(producto1._id);
    const p2 = await Producto.findById(producto2._id);
    expect(p1.stock).toBeGreaterThanOrEqual(0);
    expect(p2.stock).toBeGreaterThanOrEqual(0);
    
    // Verify stock was reduced correctly
    const exitosasP1 = exitosas.filter(r => r.productoId.equals(producto1._id));
    const exitosasP2 = exitosas.filter(r => r.productoId.equals(producto2._id));
    expect(p1.stock).toBe(3 - exitosasP1.length);
    expect(p2.stock).toBe(3 - exitosasP2.length);
  });

  it('should handle concurrent multi-product sales correctly', async () => {
    const producto1 = await Producto.create({
      nombre: 'Producto A',
      precio_venta: 100,
      stock: 5,
      activo: true
    });

    const producto2 = await Producto.create({
      nombre: 'Producto B',
      precio_venta: 80,
      stock: 5,
      activo: true
    });

    // 3 concurrent sales, each buying 2 units of product A and 1 unit of product B
    const ventas = Array(3).fill(null).map(() =>
      mongoose.startSession().then(async session => {
        try {
          session.startTransaction();
          const items = [
            { producto_id: producto1._id, cantidad: 2 },
            { producto_id: producto2._id, cantidad: 1 }
          ];
          const result = await StockService.descontarMultiple(items, session);
          await session.commitTransaction();
          return { success: true, result };
        } catch (error) {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
          return { success: false, error: error.message };
        } finally {
          session.endSession();
        }
      })
    );

    const resultados = await Promise.all(ventas);

    // At least one should succeed
    const exitosas = resultados.filter(r => r.success);
    expect(exitosas.length).toBeGreaterThan(0);

    // Verify final stock is never negative
    const p1 = await Producto.findById(producto1._id);
    const p2 = await Producto.findById(producto2._id);
    expect(p1.stock).toBeGreaterThanOrEqual(0);
    expect(p2.stock).toBeGreaterThanOrEqual(0);
    
    // Stock should be consistent with number of successful sales
    expect(p1.stock).toBe(5 - (exitosas.length * 2));
    expect(p2.stock).toBe(5 - exitosas.length);
  });
});
