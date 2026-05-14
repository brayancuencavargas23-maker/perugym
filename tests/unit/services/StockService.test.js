const mongoose = require('mongoose');
const StockService = require('../../../services/StockService');
const Producto = require('../../../models/Producto');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../../helpers/setup');
const { BusinessError } = require('../../../middleware/errors/ErrorTypes');

describe('StockService', () => {
  beforeAll(async () => await setupTestDB(), 60000);
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  describe('descontarStock', () => {
    it('should deduct stock correctly when sufficient stock available', async () => {
      const producto = await Producto.create({
        nombre: 'Proteína',
        precio_venta: 100,
        stock: 10,
        activo: true
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const resultado = await StockService.descontarStock(
          producto._id,
          3,
          session
        );

        expect(resultado.stock).toBe(7);
        await session.commitTransaction();
      } finally {
        session.endSession();
      }

      // Verify stock was actually updated
      const productoActualizado = await Producto.findById(producto._id);
      expect(productoActualizado.stock).toBe(7);
    });

    it('should throw BusinessError when insufficient stock', async () => {
      const producto = await Producto.create({
        nombre: 'Creatina',
        precio_venta: 80,
        stock: 2,
        activo: true
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          StockService.descontarStock(producto._id, 5, session)
        ).rejects.toThrow(BusinessError);

        await expect(
          StockService.descontarStock(producto._id, 5, session)
        ).rejects.toThrow('Stock insuficiente');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }

      // Verify stock was NOT modified
      const productoActualizado = await Producto.findById(producto._id);
      expect(productoActualizado.stock).toBe(2);
    });

    it('should throw BusinessError when product not found', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          StockService.descontarStock(fakeId, 1, session)
        ).rejects.toThrow(BusinessError);

        await expect(
          StockService.descontarStock(fakeId, 1, session)
        ).rejects.toThrow('Producto no encontrado');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should throw BusinessError when product is inactive', async () => {
      const producto = await Producto.create({
        nombre: 'BCAA',
        precio_venta: 60,
        stock: 10,
        activo: false
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          StockService.descontarStock(producto._id, 1, session)
        ).rejects.toThrow(BusinessError);

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe('revertirStock', () => {
    it('should revert stock correctly', async () => {
      const producto = await Producto.create({
        nombre: 'BCAA',
        precio_venta: 60,
        stock: 5,
        activo: true
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const resultado = await StockService.revertirStock(
          producto._id,
          3,
          session
        );

        expect(resultado.stock).toBe(8);
        await session.commitTransaction();
      } finally {
        session.endSession();
      }

      // Verify stock was actually updated
      const productoActualizado = await Producto.findById(producto._id);
      expect(productoActualizado.stock).toBe(8);
    });
  });

  describe('descontarMultiple', () => {
    it('should deduct stock for multiple products', async () => {
      const producto1 = await Producto.create({
        nombre: 'Proteína',
        precio_venta: 100,
        stock: 10,
        activo: true
      });

      const producto2 = await Producto.create({
        nombre: 'Creatina',
        precio_venta: 80,
        stock: 5,
        activo: true
      });

      const items = [
        { producto_id: producto1._id, cantidad: 2 },
        { producto_id: producto2._id, cantidad: 1 }
      ];

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const resultado = await StockService.descontarMultiple(items, session);

        expect(resultado).toHaveLength(2);
        expect(resultado[0].cantidad).toBe(2);
        expect(resultado[0].precio_unit).toBe(100);
        expect(resultado[0].subtotal).toBe(200);
        expect(resultado[1].cantidad).toBe(1);
        expect(resultado[1].precio_unit).toBe(80);
        expect(resultado[1].subtotal).toBe(80);

        await session.commitTransaction();
      } finally {
        session.endSession();
      }

      // Verify stock was updated for both products
      const p1 = await Producto.findById(producto1._id);
      const p2 = await Producto.findById(producto2._id);
      expect(p1.stock).toBe(8);
      expect(p2.stock).toBe(4);
    });

    it('should rollback all if one product fails', async () => {
      const producto1 = await Producto.create({
        nombre: 'Proteína',
        precio_venta: 100,
        stock: 10,
        activo: true
      });

      const producto2 = await Producto.create({
        nombre: 'Creatina',
        precio_venta: 80,
        stock: 2,
        activo: true
      });

      const items = [
        { producto_id: producto1._id, cantidad: 2 },
        { producto_id: producto2._id, cantidad: 10 } // This will fail
      ];

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          StockService.descontarMultiple(items, session)
        ).rejects.toThrow(BusinessError);

        await session.abortTransaction();
      } finally {
        session.endSession();
      }

      // Verify NO stock was modified
      const p1 = await Producto.findById(producto1._id);
      const p2 = await Producto.findById(producto2._id);
      expect(p1.stock).toBe(10);
      expect(p2.stock).toBe(2);
    });
  });

  describe('revertirMultiple', () => {
    it('should revert stock for multiple products', async () => {
      const producto1 = await Producto.create({
        nombre: 'Proteína',
        precio_venta: 100,
        stock: 5,
        activo: true
      });

      const producto2 = await Producto.create({
        nombre: 'Creatina',
        precio_venta: 80,
        stock: 3,
        activo: true
      });

      const items = [
        { producto_id: producto1._id, cantidad: 2 },
        { producto_id: producto2._id, cantidad: 1 }
      ];

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await StockService.revertirMultiple(items, session);
        await session.commitTransaction();
      } finally {
        session.endSession();
      }

      // Verify stock was reverted for both products
      const p1 = await Producto.findById(producto1._id);
      const p2 = await Producto.findById(producto2._id);
      expect(p1.stock).toBe(7);
      expect(p2.stock).toBe(4);
    });
  });
});
