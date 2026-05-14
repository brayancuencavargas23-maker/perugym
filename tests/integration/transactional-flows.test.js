const mongoose = require('mongoose');
const Solicitud = require('../../models/Solicitud');
const Cliente = require('../../models/Cliente');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');
const Plan = require('../../models/Plan');
const Caja = require('../../models/Caja');
const Usuario = require('../../models/Usuario');
const TransactionManager = require('../../utils/TransactionManager');
const MembresiaService = require('../../services/MembresiaService');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');
const { createPlan, createCliente, createCaja, createUsuario } = require('../helpers/factories');

describe('Transactional Flows Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 60000);
  
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  describe('Solicitud Conversion Flow', () => {
    it('should create cliente + membresía + pago atomically or nothing', async () => {
      // Arrange: Create plan, caja, and solicitud
      const plan = await createPlan({ precio: 100, duracion_dias: 30 });
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id });
      
      const solicitud = await Solicitud.create({
        nombre: 'Juan Pérez',
        telefono: '987654321',
        plan_id: plan._id,
        estado: 'pendiente'
      });

      // Act: Convert solicitud within transaction
      const result = await TransactionManager.execute(async (session) => {
        // Get solicitud
        const sol = await Solicitud.findById(solicitud._id)
          .populate('plan_id')
          .session(session);

        // Create cliente
        const [cliente] = await Cliente.create(
          [{
            nombre: sol.nombre,
            telefono: sol.telefono,
            apellido_paterno: 'Pérez',
            apellido_materno: 'García'
          }],
          { session }
        );

        // Create membresía using service
        const membresia = await MembresiaService.crear({
          cliente_id: cliente._id,
          plan_id: sol.plan_id._id,
          estado_pago: 'pagado'
        }, session);

        // Create pago
        const [pago] = await Pago.create(
          [{
            cliente_id: cliente._id,
            membresia_id: membresia._id,
            caja_id: caja._id,
            monto: sol.plan_id.precio,
            metodo_pago: 'efectivo',
            estado: 'pagado'
          }],
          { session }
        );

        // Update solicitud
        await Solicitud.findByIdAndUpdate(
          solicitud._id,
          { estado: 'convertido', cliente_id: cliente._id },
          { session }
        );

        return { cliente, membresia, pago };
      });

      // Assert: All entities created
      expect(result.cliente).toBeDefined();
      expect(result.membresia).toBeDefined();
      expect(result.pago).toBeDefined();

      // Verify in database
      const clienteDB = await Cliente.findById(result.cliente._id);
      const membresiaDB = await Membresia.findById(result.membresia._id);
      const pagoDB = await Pago.findById(result.pago._id);
      const solicitudDB = await Solicitud.findById(solicitud._id);

      expect(clienteDB).toBeDefined();
      expect(membresiaDB).toBeDefined();
      expect(membresiaDB.estado).toBe('activo');
      expect(pagoDB).toBeDefined();
      expect(pagoDB.estado).toBe('pagado');
      expect(solicitudDB.estado).toBe('convertido');
    });

    it('should rollback all changes if transaction fails', async () => {
      // Arrange: Create plan, caja, and solicitud
      const plan = await createPlan({ precio: 100, duracion_dias: 30 });
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id });
      
      const solicitud = await Solicitud.create({
        nombre: 'María López',
        telefono: '987654322',
        plan_id: plan._id,
        estado: 'pendiente'
      });

      // Act: Try to convert but force an error
      try {
        await TransactionManager.execute(async (session) => {
          const sol = await Solicitud.findById(solicitud._id)
            .populate('plan_id')
            .session(session);

          // Create cliente
          const [cliente] = await Cliente.create(
            [{
              nombre: sol.nombre,
              telefono: sol.telefono,
              apellido_paterno: 'López',
              apellido_materno: 'Martínez'
            }],
            { session }
          );

          // Create membresía
          const membresia = await MembresiaService.crear({
            cliente_id: cliente._id,
            plan_id: sol.plan_id._id,
            estado_pago: 'pagado'
          }, session);

          // Force an error before completing
          throw new Error('Simulated error');
        });
      } catch (error) {
        expect(error.message).toBe('Simulated error');
      }

      // Assert: Nothing should be created
      const clientes = await Cliente.find({});
      const membresias = await Membresia.find({});
      const pagos = await Pago.find({});
      const solicitudDB = await Solicitud.findById(solicitud._id);

      expect(clientes.length).toBe(0);
      expect(membresias.length).toBe(0);
      expect(pagos.length).toBe(0);
      expect(solicitudDB.estado).toBe('pendiente'); // Should remain unchanged
    });
  });

  describe('Membership Subscription Flow', () => {
    it('should create membresía + pago atomically or nothing', async () => {
      // Arrange: Create cliente, plan, and caja
      const cliente = await createCliente();
      const plan = await createPlan({ precio: 150, duracion_dias: 30 });
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id });

      // Act: Create subscription within transaction
      const result = await TransactionManager.execute(async (session) => {
        // Create membresía
        const membresia = await MembresiaService.crear({
          cliente_id: cliente._id,
          plan_id: plan._id,
          estado_pago: 'pagado'
        }, session);

        // Create pago
        const [pago] = await Pago.create(
          [{
            cliente_id: cliente._id,
            membresia_id: membresia._id,
            caja_id: caja._id,
            monto: plan.precio,
            metodo_pago: 'efectivo',
            estado: 'pagado'
          }],
          { session }
        );

        return { membresia, pago };
      });

      // Assert: Both entities created
      expect(result.membresia).toBeDefined();
      expect(result.pago).toBeDefined();

      // Verify in database
      const membresiaDB = await Membresia.findById(result.membresia._id);
      const pagoDB = await Pago.findById(result.pago._id);

      expect(membresiaDB).toBeDefined();
      expect(membresiaDB.estado).toBe('activo');
      expect(pagoDB).toBeDefined();
      expect(pagoDB.monto).toBe(150);
    });

    it('should rollback if payment creation fails', async () => {
      // Arrange
      const cliente = await createCliente();
      const plan = await createPlan({ precio: 150, duracion_dias: 30 });
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id });

      // Act: Try to create subscription but fail on payment
      try {
        await TransactionManager.execute(async (session) => {
          // Create membresía
          await MembresiaService.crear({
            cliente_id: cliente._id,
            plan_id: plan._id,
            estado_pago: 'pagado'
          }, session);

          // Force error before creating payment
          throw new Error('Payment processing failed');
        });
      } catch (error) {
        expect(error.message).toBe('Payment processing failed');
      }

      // Assert: Nothing should be created
      const membresias = await Membresia.find({});
      const pagos = await Pago.find({});

      expect(membresias.length).toBe(0);
      expect(pagos.length).toBe(0);
    });
  });

  describe('Plan Change Flow', () => {
    it('should cancel current + create new + register payment atomically or nothing', async () => {
      // Arrange: Create cliente with active membership
      const cliente = await createCliente();
      const planActual = await createPlan({ nombre: 'Plan Básico', precio: 100, duracion_dias: 30 });
      const planNuevo = await createPlan({ nombre: 'Plan Premium', precio: 200, duracion_dias: 30 });
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id });

      // Create initial membership
      const membresiaActual = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: planActual._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'activo'
      });

      // Act: Change plan within transaction
      const result = await TransactionManager.execute(async (session) => {
        // Change plan using service
        const nuevaMembresia = await MembresiaService.cambiarPlan(
          membresiaActual._id,
          {
            plan_id: planNuevo._id,
            estado_pago: 'pagado'
          },
          session
        );

        // Create payment
        const [pago] = await Pago.create(
          [{
            cliente_id: cliente._id,
            membresia_id: nuevaMembresia._id,
            caja_id: caja._id,
            monto: planNuevo.precio,
            metodo_pago: 'efectivo',
            estado: 'pagado'
          }],
          { session }
        );

        return { nuevaMembresia, pago };
      });

      // Assert: New membership created and old one cancelled
      expect(result.nuevaMembresia).toBeDefined();
      expect(result.pago).toBeDefined();

      // Verify in database
      const membresiaAnterior = await Membresia.findById(membresiaActual._id);
      const membresiaNueva = await Membresia.findById(result.nuevaMembresia._id);
      const pagoDB = await Pago.findById(result.pago._id);

      expect(membresiaAnterior.estado).toBe('cancelado');
      expect(membresiaNueva.estado).toBe('activo');
      expect(membresiaNueva.plan_id.toString()).toBe(planNuevo._id.toString());
      expect(pagoDB.monto).toBe(200);
    });

    it('should rollback if plan change fails', async () => {
      // Arrange
      const cliente = await createCliente();
      const planActual = await createPlan({ nombre: 'Plan Básico', precio: 100, duracion_dias: 30 });
      const planNuevo = await createPlan({ nombre: 'Plan Premium', precio: 200, duracion_dias: 30 });

      const membresiaActual = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: planActual._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'activo'
      });

      // Act: Try to change plan but force error
      try {
        await TransactionManager.execute(async (session) => {
          await MembresiaService.cambiarPlan(
            membresiaActual._id,
            {
              plan_id: planNuevo._id,
              estado_pago: 'pagado'
            },
            session
          );

          // Force error
          throw new Error('Plan change failed');
        });
      } catch (error) {
        expect(error.message).toBe('Plan change failed');
      }

      // Assert: Original membership should remain active
      const membresiaDB = await Membresia.findById(membresiaActual._id);
      expect(membresiaDB.estado).toBe('activo');
      expect(membresiaDB.plan_id.toString()).toBe(planActual._id.toString());

      // No new memberships should be created
      const membresias = await Membresia.find({});
      expect(membresias.length).toBe(1);
    });
  });

  describe('Membership Renewal Flow', () => {
    it('should create new membresía + pago atomically or nothing', async () => {
      // Arrange: Create cliente with expired membership
      const cliente = await createCliente();
      const plan = await createPlan({ precio: 120, duracion_dias: 30 });
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id });

      const membresiaVencida = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
        fecha_fin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        estado: 'vencido'
      });

      // Act: Renew membership within transaction
      const result = await TransactionManager.execute(async (session) => {
        // Renew using service
        const nuevaMembresia = await MembresiaService.renovar(
          membresiaVencida._id,
          'pagado',
          session
        );

        // Create payment
        const [pago] = await Pago.create(
          [{
            cliente_id: cliente._id,
            membresia_id: nuevaMembresia._id,
            caja_id: caja._id,
            monto: plan.precio,
            metodo_pago: 'efectivo',
            estado: 'pagado'
          }],
          { session }
        );

        return { nuevaMembresia, pago };
      });

      // Assert: New membership created
      expect(result.nuevaMembresia).toBeDefined();
      expect(result.pago).toBeDefined();

      // Verify in database
      const membresiaNueva = await Membresia.findById(result.nuevaMembresia._id);
      const pagoDB = await Pago.findById(result.pago._id);

      expect(membresiaNueva.estado).toBe('activo');
      expect(membresiaNueva.cliente_id.toString()).toBe(cliente._id.toString());
      expect(pagoDB.monto).toBe(120);

      // Old membership should remain expired
      const membresiaVieja = await Membresia.findById(membresiaVencida._id);
      expect(membresiaVieja.estado).toBe('vencido');
    });

    it('should rollback if renewal fails', async () => {
      // Arrange
      const cliente = await createCliente();
      const plan = await createPlan({ precio: 120, duracion_dias: 30 });

      const membresiaVencida = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        fecha_fin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        estado: 'vencido'
      });

      // Act: Try to renew but force error
      try {
        await TransactionManager.execute(async (session) => {
          await MembresiaService.renovar(
            membresiaVencida._id,
            'pagado',
            session
          );

          // Force error
          throw new Error('Renewal failed');
        });
      } catch (error) {
        expect(error.message).toBe('Renewal failed');
      }

      // Assert: No new membership should be created
      const membresias = await Membresia.find({});
      expect(membresias.length).toBe(1);
      expect(membresias[0]._id.toString()).toBe(membresiaVencida._id.toString());
      expect(membresias[0].estado).toBe('vencido');
    });
  });

  describe('Complex Multi-Entity Transactions', () => {
    it('should handle complex transaction with multiple entities', async () => {
      // Arrange: Create multiple entities
      const plan = await createPlan({ precio: 180, duracion_dias: 30 });
      const usuario = await createUsuario();
      const caja = await createCaja({ usuario_id: usuario._id });

      // Act: Create solicitud, convert to cliente, create membership and payment
      const result = await TransactionManager.execute(async (session) => {
        // Create solicitud
        const [solicitud] = await Solicitud.create(
          [{
            nombre: 'Carlos Ruiz',
            telefono: '987654323',
            plan_id: plan._id,
            estado: 'pendiente'
          }],
          { session }
        );

        // Create cliente
        const [cliente] = await Cliente.create(
          [{
            nombre: 'Carlos',
            apellido_paterno: 'Ruiz',
            apellido_materno: 'Sánchez',
            telefono: '987654323'
          }],
          { session }
        );

        // Create membership
        const membresia = await MembresiaService.crear({
          cliente_id: cliente._id,
          plan_id: plan._id,
          estado_pago: 'pagado'
        }, session);

        // Create payment
        const [pago] = await Pago.create(
          [{
            cliente_id: cliente._id,
            membresia_id: membresia._id,
            caja_id: caja._id,
            monto: plan.precio,
            metodo_pago: 'efectivo',
            estado: 'pagado'
          }],
          { session }
        );

        // Update solicitud
        await Solicitud.findByIdAndUpdate(
          solicitud._id,
          { estado: 'convertido', cliente_id: cliente._id },
          { session }
        );

        return { solicitud, cliente, membresia, pago };
      });

      // Assert: All entities created correctly
      expect(result.solicitud).toBeDefined();
      expect(result.cliente).toBeDefined();
      expect(result.membresia).toBeDefined();
      expect(result.pago).toBeDefined();

      // Verify relationships
      const solicitudDB = await Solicitud.findById(result.solicitud._id);
      const clienteDB = await Cliente.findById(result.cliente._id);
      const membresiaDB = await Membresia.findById(result.membresia._id);
      const pagoDB = await Pago.findById(result.pago._id);

      expect(solicitudDB.estado).toBe('convertido');
      expect(solicitudDB.cliente_id.toString()).toBe(clienteDB._id.toString());
      expect(membresiaDB.cliente_id.toString()).toBe(clienteDB._id.toString());
      expect(pagoDB.cliente_id.toString()).toBe(clienteDB._id.toString());
      expect(pagoDB.membresia_id.toString()).toBe(membresiaDB._id.toString());
    });
  });
});
