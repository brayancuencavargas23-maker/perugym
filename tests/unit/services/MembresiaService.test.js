const mongoose = require('mongoose');
const MembresiaService = require('../../../services/MembresiaService');
const Membresia = require('../../../models/Membresia');
const Plan = require('../../../models/Plan');
const Cliente = require('../../../models/Cliente');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../../helpers/setup');
const { createCliente, createPlan } = require('../../helpers/factories');
const { BusinessError, NotFoundError } = require('../../../middleware/errors/ErrorTypes');

describe('MembresiaService', () => {
  beforeAll(async () => await setupTestDB(), 60000);
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  describe('autoVencer', () => {
    it('should expire only expired memberships (not active ones with future date)', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      // Create expired membership
      const fechaInicioExpirada = new Date();
      fechaInicioExpirada.setDate(fechaInicioExpirada.getDate() - 40);
      const fechaFinExpirada = new Date();
      fechaFinExpirada.setDate(fechaFinExpirada.getDate() - 10);

      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: fechaInicioExpirada,
        fecha_fin: fechaFinExpirada,
        estado: 'activo'
      });

      // Create active membership with future date
      const cliente2 = await createCliente();
      const fechaInicioActiva = new Date();
      const fechaFinActiva = new Date();
      fechaFinActiva.setDate(fechaFinActiva.getDate() + 20);

      await Membresia.create({
        cliente_id: cliente2._id,
        plan_id: plan._id,
        fecha_inicio: fechaInicioActiva,
        fecha_fin: fechaFinActiva,
        estado: 'activo'
      });

      // Execute autoVencer
      const count = await MembresiaService.autoVencer();

      expect(count).toBe(1);

      // Verify only expired membership was updated
      const expirada = await Membresia.findOne({ cliente_id: cliente._id });
      const activa = await Membresia.findOne({ cliente_id: cliente2._id });

      expect(expirada.estado).toBe('vencido');
      expect(activa.estado).toBe('activo');
    });

    it('should be idempotent (running twice does not change result)', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      // Create expired membership
      const fechaInicioExpirada = new Date();
      fechaInicioExpirada.setDate(fechaInicioExpirada.getDate() - 40);
      const fechaFinExpirada = new Date();
      fechaFinExpirada.setDate(fechaFinExpirada.getDate() - 10);

      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: fechaInicioExpirada,
        fecha_fin: fechaFinExpirada,
        estado: 'activo'
      });

      // First execution
      const count1 = await MembresiaService.autoVencer();
      expect(count1).toBe(1);

      // Second execution
      const count2 = await MembresiaService.autoVencer();
      expect(count2).toBe(0);

      // Verify membership is still expired
      const membresia = await Membresia.findOne({ cliente_id: cliente._id });
      expect(membresia.estado).toBe('vencido');
    });
  });

  describe('tieneMembresiaActiva', () => {
    it('should detect active membership', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await Membresia.create(
          [{
            cliente_id: cliente._id,
            plan_id: plan._id,
            fecha_inicio: new Date(),
            fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            estado: 'activo'
          }],
          { session }
        );

        const tieneActiva = await MembresiaService.tieneMembresiaActiva(cliente._id, session);

        expect(tieneActiva).toBe(true);

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should return false if no active membership', async () => {
      const cliente = await createCliente();

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const tieneActiva = await MembresiaService.tieneMembresiaActiva(cliente._id, session);

        expect(tieneActiva).toBe(false);

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe('crear', () => {
    it('should reject if client already has active membership', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Create first membership
        await MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan._id,
            estado_pago: 'pagado'
          },
          session
        );

        // Try to create second membership
        await expect(
          MembresiaService.crear(
            {
              cliente_id: cliente._id,
              plan_id: plan._id,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow(BusinessError);

        await expect(
          MembresiaService.crear(
            {
              cliente_id: cliente._id,
              plan_id: plan._id,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow('El cliente ya tiene una membresía activa');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should calculate fecha_fin correctly (fecha_inicio + duracion_dias)', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const fechaInicio = new Date('2024-01-01');
        const membresia = await MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan._id,
            fecha_inicio: fechaInicio,
            estado_pago: 'pagado'
          },
          session
        );

        const expectedFechaFin = new Date('2024-01-01');
        expectedFechaFin.setDate(expectedFechaFin.getDate() + 30);

        expect(membresia.fecha_fin.toISOString()).toBe(expectedFechaFin.toISOString());

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should set estado to "activo" when estado_pago is "pagado"', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const membresia = await MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan._id,
            estado_pago: 'pagado'
          },
          session
        );

        expect(membresia.estado).toBe('activo');

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should set estado to "pendiente" when estado_pago is "pendiente"', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const membresia = await MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan._id,
            estado_pago: 'pendiente'
          },
          session
        );

        expect(membresia.estado).toBe('pendiente');

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should throw NotFoundError if plan does not exist or is inactive', async () => {
      const cliente = await createCliente();
      const fakeId = new mongoose.Types.ObjectId();

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Test with non-existent plan
        await expect(
          MembresiaService.crear(
            {
              cliente_id: cliente._id,
              plan_id: fakeId,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow(NotFoundError);

        await expect(
          MembresiaService.crear(
            {
              cliente_id: cliente._id,
              plan_id: fakeId,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow('Plan no encontrado o inactivo');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }

      // Test with inactive plan
      const planInactivo = await createPlan({ duracion_dias: 30, activo: false });

      const session2 = await mongoose.startSession();
      session2.startTransaction();

      try {
        await expect(
          MembresiaService.crear(
            {
              cliente_id: cliente._id,
              plan_id: planInactivo._id,
              estado_pago: 'pagado'
            },
            session2
          )
        ).rejects.toThrow(NotFoundError);

        await session2.abortTransaction();
      } finally {
        session2.endSession();
      }
    });
  });

  describe('cambiarPlan', () => {
    it('should cancel current and create new membership', async () => {
      const cliente = await createCliente();
      const plan1 = await createPlan({ duracion_dias: 30, nombre: 'Plan Mensual' });
      const plan2 = await createPlan({ duracion_dias: 90, nombre: 'Plan Trimestral' });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Create initial membership
        const membresiaInicial = await MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan1._id,
            estado_pago: 'pagado'
          },
          session
        );

        // Change plan
        const nuevaMembresia = await MembresiaService.cambiarPlan(
          membresiaInicial._id,
          {
            plan_id: plan2._id,
            estado_pago: 'pagado'
          },
          session
        );

        expect(nuevaMembresia.plan_id.toString()).toBe(plan2._id.toString());
        expect(nuevaMembresia.estado).toBe('activo');

        // Verify old membership was cancelled
        const membresiaAntigua = await Membresia.findById(membresiaInicial._id).session(session);
        expect(membresiaAntigua.estado).toBe('cancelado');

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should reject if membership is not active or pending', async () => {
      const cliente = await createCliente();
      const plan1 = await createPlan({ duracion_dias: 30 });
      const plan2 = await createPlan({ duracion_dias: 90 });

      // Create cancelled membership
      const membresiaCancelada = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan1._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'cancelado'
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          MembresiaService.cambiarPlan(
            membresiaCancelada._id,
            {
              plan_id: plan2._id,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow(BusinessError);

        await expect(
          MembresiaService.cambiarPlan(
            membresiaCancelada._id,
            {
              plan_id: plan2._id,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow('Solo se puede cambiar el plan de una membresía activa o pendiente');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should throw NotFoundError if membership does not exist', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          MembresiaService.cambiarPlan(
            fakeId,
            {
              plan_id: plan._id,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow(NotFoundError);

        await expect(
          MembresiaService.cambiarPlan(
            fakeId,
            {
              plan_id: plan._id,
              estado_pago: 'pagado'
            },
            session
          )
        ).rejects.toThrow('Membresía no encontrada');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe('activarPendiente', () => {
    it('should change estado from "pendiente" to "activo"', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Create pending membership
        const membresia = await MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan._id,
            estado_pago: 'pendiente'
          },
          session
        );

        expect(membresia.estado).toBe('pendiente');

        // Activate membership
        const membresiaActivada = await MembresiaService.activarPendiente(membresia._id, session);

        expect(membresiaActivada.estado).toBe('activo');

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should reject if membership is not in "pendiente" estado', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Create active membership
        const membresia = await MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan._id,
            estado_pago: 'pagado'
          },
          session
        );

        expect(membresia.estado).toBe('activo');

        // Try to activate already active membership
        await expect(
          MembresiaService.activarPendiente(membresia._id, session)
        ).rejects.toThrow(BusinessError);

        await expect(
          MembresiaService.activarPendiente(membresia._id, session)
        ).rejects.toThrow('Solo se pueden activar membresías en estado pendiente');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });
  });

  describe('renovar', () => {
    it('should create new membership with same plan', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      // Create expired membership
      const membresiaVencida = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        fecha_fin: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        estado: 'vencido'
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const nuevaMembresia = await MembresiaService.renovar(
          membresiaVencida._id,
          'pagado',
          session
        );

        expect(nuevaMembresia.plan_id.toString()).toBe(plan._id.toString());
        expect(nuevaMembresia.cliente_id.toString()).toBe(cliente._id.toString());
        expect(nuevaMembresia.estado).toBe('activo');

        await session.commitTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should reject if membership is still active', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      // Create active membership
      const membresiaActiva = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        estado: 'activo'
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          MembresiaService.renovar(membresiaActiva._id, 'pagado', session)
        ).rejects.toThrow(BusinessError);

        await expect(
          MembresiaService.renovar(membresiaActiva._id, 'pagado', session)
        ).rejects.toThrow('La membresía aún está activa');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });

    it('should reject if client already has another active membership', async () => {
      const cliente = await createCliente();
      const plan = await createPlan({ duracion_dias: 30 });

      // Create expired membership
      const membresiaVencida = await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        fecha_fin: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        estado: 'vencido'
      });

      // Create another active membership for the same client
      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        estado: 'activo'
      });

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await expect(
          MembresiaService.renovar(membresiaVencida._id, 'pagado', session)
        ).rejects.toThrow(BusinessError);

        await expect(
          MembresiaService.renovar(membresiaVencida._id, 'pagado', session)
        ).rejects.toThrow('El cliente ya tiene una membresía activa');

        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    });
  });
});
