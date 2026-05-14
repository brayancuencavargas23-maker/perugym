const mongoose = require('mongoose');
const Caja = require('../../models/Caja');
const CajaService = require('../../services/CajaService');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');
const { createUsuario, createCaja } = require('../helpers/factories');

describe('Caja Race Conditions', () => {
  beforeAll(async () => {
    await setupTestDB();
    
    // Create unique partial index for open cash registers (simulating migration)
    const db = mongoose.connection.db;
    try {
      await db.collection('cajas').createIndex(
        { estado: 1 },
        {
          unique: true,
          partialFilterExpression: { estado: 'abierta' },
          name: 'idx_estado_abierta'
        }
      );
    } catch (error) {
      // Index might already exist
      if (error.code !== 85) {
        throw error;
      }
    }
  }, 60000);
  
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  describe('Concurrency in closing', () => {
    it('should allow only 1 successful close when 5 users try to close same cash register', async () => {
      // Arrange: Create an open cash register
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id, estado: 'abierta' });

      // Act: 5 users try to close the same cash register simultaneously
      const cierres = Array(5).fill(null).map(() =>
        mongoose.startSession().then(async session => {
          try {
            session.startTransaction();
            const result = await CajaService.cerrar(
              caja._id,
              { monto_final: 100, notas: 'Cierre concurrente' },
              session
            );
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

      const resultados = await Promise.all(cierres);

      // Assert: Only 1 should succeed
      const exitosas = resultados.filter(r => r.success);
      const fallidas = resultados.filter(r => !r.success);

      expect(exitosas.length).toBe(1);
      expect(fallidas.length).toBe(4);

      // Verify cash register is closed
      const cajaFinal = await Caja.findById(caja._id);
      expect(cajaFinal.estado).toBe('cerrada');
      expect(cajaFinal.cierre).toBeDefined();
      expect(cajaFinal.monto_final).toBe(100);
    });
  });

  describe('Concurrency in opening', () => {
    it('should allow only 1 successful open when 5 users try to open cash register simultaneously', async () => {
      // Arrange: Create 5 users
      const usuarios = await Promise.all(
        Array(5).fill(null).map(() => createUsuario())
      );

      // Act: 5 users try to open a cash register simultaneously
      const aperturas = usuarios.map(usuario =>
        mongoose.startSession().then(async session => {
          try {
            session.startTransaction();
            const result = await CajaService.abrir(
              {
                usuario_id: usuario._id,
                monto_inicial: 50,
                notas: 'Apertura concurrente'
              },
              session
            );
            await session.commitTransaction();
            return { success: true, result, usuario_id: usuario._id };
          } catch (error) {
            if (session.inTransaction()) {
              await session.abortTransaction();
            }
            return { success: false, error: error.message, usuario_id: usuario._id };
          } finally {
            session.endSession();
          }
        })
      );

      const resultados = await Promise.all(aperturas);

      // Assert: Only 1 should succeed due to unique partial index
      const exitosas = resultados.filter(r => r.success);
      const fallidas = resultados.filter(r => !r.success);

      expect(exitosas.length).toBe(1);
      expect(fallidas.length).toBe(4);

      // Verify only one cash register is open
      const cajasAbiertas = await Caja.find({ estado: 'abierta' });
      expect(cajasAbiertas.length).toBe(1);
      expect(cajasAbiertas[0].monto_inicial).toBe(50);
      expect(cajasAbiertas[0].notas).toBe('Apertura concurrente');
    });

    it('should prevent multiple open cash registers with unique index', async () => {
      // Arrange: Create first open cash register
      const usuario1 = await createUsuario();
      const caja1 = await createCaja({ usuario_id: usuario1._id, estado: 'abierta' });

      // Act: Try to create another open cash register directly (bypassing service)
      const usuario2 = await createUsuario();

      // This should fail due to unique index on estado='abierta'
      // Note: MongoDB doesn't have a built-in unique index for specific field values,
      // but we can test that the service layer prevents it
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          CajaService.abrir(
            {
              usuario_id: usuario2._id,
              monto_inicial: 100
            },
            session
          )
        ).rejects.toThrow('Ya hay una caja abierta');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }

      // Verify only one cash register is open
      const cajasAbiertas = await Caja.find({ estado: 'abierta' });
      expect(cajasAbiertas.length).toBe(1);
      expect(cajasAbiertas[0]._id.toString()).toBe(caja1._id.toString());
    });
  });

  describe('Mixed concurrent operations', () => {
    it('should handle concurrent open and close operations correctly', async () => {
      // Arrange: Create an open cash register
      const usuario1 = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario1._id, estado: 'abierta' });

      // Create additional users for opening attempts
      const usuarios = await Promise.all(
        Array(3).fill(null).map(() => createUsuario())
      );

      // Act: 2 users try to close, 3 users try to open simultaneously
      const operaciones = [
        // 2 close attempts
        ...Array(2).fill(null).map(() =>
          mongoose.startSession().then(async session => {
            try {
              session.startTransaction();
              const result = await CajaService.cerrar(
                caja._id,
                { monto_final: 200 },
                session
              );
              await session.commitTransaction();
              return { success: true, tipo: 'cerrar', result };
            } catch (error) {
              if (session.inTransaction()) {
                await session.abortTransaction();
              }
              return { success: false, tipo: 'cerrar', error: error.message };
            } finally {
              session.endSession();
            }
          })
        ),
        // 3 open attempts
        ...usuarios.map(usuario =>
          mongoose.startSession().then(async session => {
            try {
              session.startTransaction();
              const result = await CajaService.abrir(
                { usuario_id: usuario._id, monto_inicial: 75 },
                session
              );
              await session.commitTransaction();
              return { success: true, tipo: 'abrir', result };
            } catch (error) {
              if (session.inTransaction()) {
                await session.abortTransaction();
              }
              return { success: false, tipo: 'abrir', error: error.message };
            } finally {
              session.endSession();
            }
          })
        )
      ];

      const resultados = await Promise.all(operaciones);

      // Assert: Only 1 close should succeed, and at most 1 open should succeed
      const cierresExitosos = resultados.filter(r => r.success && r.tipo === 'cerrar');
      const aperturasExitosas = resultados.filter(r => r.success && r.tipo === 'abrir');

      expect(cierresExitosos.length).toBe(1);
      expect(aperturasExitosas.length).toBeLessThanOrEqual(1);

      // Verify final state
      const todasLasCajas = await Caja.find({});
      const cajasAbiertas = todasLasCajas.filter(c => c.estado === 'abierta');
      const cajasCerradas = todasLasCajas.filter(c => c.estado === 'cerrada');

      // Should have at most 1 open cash register
      expect(cajasAbiertas.length).toBeLessThanOrEqual(1);
      // Should have at least 1 closed cash register (the original one)
      expect(cajasCerradas.length).toBeGreaterThanOrEqual(1);
    });
  });
});
