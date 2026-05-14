const mongoose = require('mongoose');
const CajaService = require('../../../services/CajaService');
const Caja = require('../../../models/Caja');
const Pago = require('../../../models/Pago');
const Venta = require('../../../models/Venta');
const MovimientoCaja = require('../../../models/MovimientoCaja');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../../helpers/setup');
const { createUsuario, createCliente, createCaja } = require('../../helpers/factories');
const { BusinessError, NotFoundError } = require('../../../middleware/errors/ErrorTypes');

describe('CajaService', () => {
  beforeAll(async () => await setupTestDB(), 60000);
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  describe('obtenerCajaAbierta', () => {
    it('should return open cash register if exists', async () => {
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id, estado: 'abierta' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const cajaAbierta = await CajaService.obtenerCajaAbierta(session);

        expect(cajaAbierta).not.toBeNull();
        expect(cajaAbierta._id.toString()).toBe(caja._id.toString());
        expect(cajaAbierta.estado).toBe('abierta');

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should return null if no open cash register', async () => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const cajaAbierta = await CajaService.obtenerCajaAbierta(session);

        expect(cajaAbierta).toBeNull();

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe('abrir', () => {
    it('should reject if there is already an open cash register', async () => {
      const usuario1 = await createUsuario();
      const usuario2 = await createUsuario();
      await createCaja({ usuario_id: usuario1._id, estado: 'abierta' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          CajaService.abrir({ usuario_id: usuario2._id }, session)
        ).rejects.toThrow(BusinessError);

        await expect(
          CajaService.abrir({ usuario_id: usuario2._id }, session)
        ).rejects.toThrow('Ya hay una caja abierta');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should create new cash register correctly', async () => {
      const usuario = await createUsuario();

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const caja = await CajaService.abrir(
          {
            usuario_id: usuario._id,
            monto_inicial: 100,
            notas: 'Apertura de prueba'
          },
          session
        );

        expect(caja).toBeDefined();
        expect(caja.usuario_id.toString()).toBe(usuario._id.toString());
        expect(caja.monto_inicial).toBe(100);
        expect(caja.estado).toBe('abierta');
        expect(caja.notas).toBe('Apertura de prueba');
        expect(caja.apertura).toBeDefined();

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should set monto_inicial to 0 by default', async () => {
      const usuario = await createUsuario();

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const caja = await CajaService.abrir({ usuario_id: usuario._id }, session);

        expect(caja.monto_inicial).toBe(0);

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe('cerrar', () => {
    it('should calculate totals correctly (with payments, sales, and movements)', async () => {
      const usuario = await createUsuario();
      const cliente = await createCliente();
      const caja = await createCaja({ usuario_id: usuario._id, estado: 'abierta' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Create payments (memberships)
        await Pago.create(
          [
            {
              cliente_id: cliente._id,
              caja_id: caja._id,
              monto: 100,
              estado: 'pagado',
              metodo_pago: 'efectivo'
            },
            {
              cliente_id: cliente._id,
              caja_id: caja._id,
              monto: 150,
              estado: 'pagado',
              metodo_pago: 'yape'
            }
          ],
          { session, ordered: true }
        );

        // Create sales
        await Venta.create(
          [
            {
              caja_id: caja._id,
              cliente_id: cliente._id,
              metodo_pago: 'efectivo',
              anulada: false,
              items: [
                {
                  producto_id: new mongoose.Types.ObjectId(),
                  cantidad: 2,
                  precio_unit: 50,
                  subtotal: 100
                }
              ]
            },
            {
              caja_id: caja._id,
              metodo_pago: 'transferencia',
              anulada: false,
              items: [
                {
                  producto_id: new mongoose.Types.ObjectId(),
                  cantidad: 1,
                  precio_unit: 75,
                  subtotal: 75
                }
              ]
            }
          ],
          { session, ordered: true }
        );

        // Create manual movements
        await MovimientoCaja.create(
          [
            {
              caja_id: caja._id,
              usuario_id: usuario._id,
              tipo: 'ingreso',
              monto: 50,
              concepto: 'Ingreso adicional'
            },
            {
              caja_id: caja._id,
              usuario_id: usuario._id,
              tipo: 'egreso',
              monto: 25,
              concepto: 'Gasto operativo'
            }
          ],
          { session, ordered: true }
        );

        // Close cash register
        const cajaCerrada = await CajaService.cerrar(
          caja._id,
          { monto_final: 450, notas: 'Cierre de prueba' },
          session
        );

        // Expected total: 100 + 150 (payments) + 100 + 75 (sales) + 50 - 25 (movements) = 450
        expect(cajaCerrada.estado).toBe('cerrada');
        expect(cajaCerrada.total_ingresos).toBe(450);
        expect(cajaCerrada.monto_final).toBe(450);
        expect(cajaCerrada.cierre).toBeDefined();
        expect(cajaCerrada.notas).toBe('Cierre de prueba');

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should reject if cash register is already closed', async () => {
      const usuario = await createUsuario();
      const caja = await createCaja({
        usuario_id: usuario._id,
        estado: 'cerrada',
        cierre: new Date()
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          CajaService.cerrar(caja._id, { monto_final: 100 }, session)
        ).rejects.toThrow(NotFoundError);

        await expect(
          CajaService.cerrar(caja._id, { monto_final: 100 }, session)
        ).rejects.toThrow('Caja no encontrada o ya cerrada');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should reject if cash register does not exist', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          CajaService.cerrar(fakeId, { monto_final: 100 }, session)
        ).rejects.toThrow(NotFoundError);

        await expect(
          CajaService.cerrar(fakeId, { monto_final: 100 }, session)
        ).rejects.toThrow('Caja no encontrada o ya cerrada');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe('registrarMovimiento', () => {
    it('should validate that cash register is open', async () => {
      const usuario = await createUsuario();
      const caja = await createCaja({
        usuario_id: usuario._id,
        estado: 'cerrada',
        cierre: new Date()
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'ingreso',
              monto: 50,
              concepto: 'Test'
            },
            session
          )
        ).rejects.toThrow(BusinessError);

        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'ingreso',
              monto: 50,
              concepto: 'Test'
            },
            session
          )
        ).rejects.toThrow('La caja no está abierta');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should validate type (ingreso/egreso)', async () => {
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id, estado: 'abierta' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'invalido',
              monto: 50,
              concepto: 'Test'
            },
            session
          )
        ).rejects.toThrow(BusinessError);

        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'invalido',
              monto: 50,
              concepto: 'Test'
            },
            session
          )
        ).rejects.toThrow('Tipo inválido. Debe ser "ingreso" o "egreso"');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should validate monto > 0', async () => {
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id, estado: 'abierta' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Test with 0
        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'ingreso',
              monto: 0,
              concepto: 'Test'
            },
            session
          )
        ).rejects.toThrow(BusinessError);

        // Test with negative
        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'ingreso',
              monto: -50,
              concepto: 'Test'
            },
            session
          )
        ).rejects.toThrow('Monto inválido. Debe ser mayor a 0');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should validate concepto is not empty', async () => {
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id, estado: 'abierta' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Test with empty string
        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'ingreso',
              monto: 50,
              concepto: ''
            },
            session
          )
        ).rejects.toThrow(BusinessError);

        // Test with whitespace only
        await expect(
          CajaService.registrarMovimiento(
            caja._id,
            {
              usuario_id: usuario._id,
              tipo: 'ingreso',
              monto: 50,
              concepto: '   '
            },
            session
          )
        ).rejects.toThrow('El concepto es requerido');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should create movement correctly', async () => {
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id, estado: 'abierta' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const movimiento = await CajaService.registrarMovimiento(
          caja._id,
          {
            usuario_id: usuario._id,
            tipo: 'ingreso',
            monto: 75.50,
            concepto: 'Ingreso de prueba'
          },
          session
        );

        expect(movimiento).toBeDefined();
        expect(movimiento.caja_id.toString()).toBe(caja._id.toString());
        expect(movimiento.usuario_id.toString()).toBe(usuario._id.toString());
        expect(movimiento.tipo).toBe('ingreso');
        expect(movimiento.monto).toBe(75.50);
        expect(movimiento.concepto).toBe('Ingreso de prueba');
        expect(movimiento.fecha).toBeDefined();

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });
  });
});
