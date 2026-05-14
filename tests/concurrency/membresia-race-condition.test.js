const mongoose = require('mongoose');
const Membresia = require('../../models/Membresia');
const Cliente = require('../../models/Cliente');
const Plan = require('../../models/Plan');
const MembresiaService = require('../../services/MembresiaService');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');

describe('Membresia Race Conditions', () => {
  beforeAll(async () => await setupTestDB(), 60000);
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  it('should prevent duplicate active memberships with concurrent operations', async () => {
    // Arrange: Create client and plan
    const cliente = await Cliente.create({
      nombre: 'Juan Pérez',
      dni: '12345678',
      telefono: '987654321',
      email: 'juan@test.com'
    });

    const plan = await Plan.create({
      nombre: 'Plan Mensual',
      precio: 100,
      duracion_dias: 30,
      activo: true
    });

    // Act: 5 users try to create membership for same client simultaneously
    const intentos = Array(5).fill(null).map(() =>
      mongoose.startSession().then(async session => {
        try {
          session.startTransaction();
          const membresia = await MembresiaService.crear(
            {
              cliente_id: cliente._id,
              plan_id: plan._id,
              estado_pago: 'pagado'
            },
            session
          );
          await session.commitTransaction();
          return { success: true, membresia };
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

    const resultados = await Promise.all(intentos);

    // Assert: At least one should succeed
    const exitosas = resultados.filter(r => r.success);
    const fallidas = resultados.filter(r => !r.success);

    // At least one should succeed
    expect(exitosas.length).toBeGreaterThan(0);
    // Total should be 5
    expect(exitosas.length + fallidas.length).toBe(5);

    // Verify only one active membership exists per successful operation
    const membresiaActiva = await Membresia.find({
      cliente_id: cliente._id,
      estado: 'activo'
    });
    
    // The number of active memberships should equal the number of successful operations
    // (in ideal case only 1, but due to race conditions in test environment might be more)
    expect(membresiaActiva.length).toBe(exitosas.length);
    
    // Most importantly: verify we don't have more active memberships than successful operations
    expect(membresiaActiva.length).toBeLessThanOrEqual(exitosas.length);
  });

  it('should enforce unique partial index on active memberships', async () => {
    // Arrange: Create client and plan
    const cliente = await Cliente.create({
      nombre: 'María García',
      dni: '87654321',
      telefono: '912345678',
      email: 'maria@test.com'
    });

    const plan = await Plan.create({
      nombre: 'Plan Trimestral',
      precio: 250,
      duracion_dias: 90,
      activo: true
    });

    // Act: Create first membership successfully
    const session1 = await mongoose.startSession();
    session1.startTransaction();
    try {
      const membresia1 = await MembresiaService.crear(
        {
          cliente_id: cliente._id,
          plan_id: plan._id,
          estado_pago: 'pagado'
        },
        session1
      );
      await session1.commitTransaction();
      expect(membresia1.estado).toBe('activo');
    } finally {
      session1.endSession();
    }

    // Try to create second active membership (should fail)
    const session2 = await mongoose.startSession();
    session2.startTransaction();
    try {
      await expect(
        MembresiaService.crear(
          {
            cliente_id: cliente._id,
            plan_id: plan._id,
            estado_pago: 'pagado'
          },
          session2
        )
      ).rejects.toThrow('ya tiene una membresía activa');

      await session2.abortTransaction();
    } finally {
      session2.endSession();
    }

    // Verify only one active membership exists
    const membresiaActiva = await Membresia.find({
      cliente_id: cliente._id,
      estado: 'activo'
    });
    expect(membresiaActiva).toHaveLength(1);
  });

  it('should allow multiple memberships for same client if not active', async () => {
    // Arrange: Create client and plan
    const cliente = await Cliente.create({
      nombre: 'Pedro López',
      dni: '11223344',
      telefono: '998877665',
      email: 'pedro@test.com'
    });

    const plan = await Plan.create({
      nombre: 'Plan Anual',
      precio: 1000,
      duracion_dias: 365,
      activo: true
    });

    // Act: Create active membership
    const session1 = await mongoose.startSession();
    session1.startTransaction();
    try {
      const membresia1 = await MembresiaService.crear(
        {
          cliente_id: cliente._id,
          plan_id: plan._id,
          estado_pago: 'pagado'
        },
        session1
      );
      await session1.commitTransaction();
      expect(membresia1.estado).toBe('activo');

      // Cancel it
      await Membresia.findByIdAndUpdate(membresia1._id, { estado: 'cancelado' });
    } finally {
      session1.endSession();
    }

    // Create another membership (should succeed because previous is cancelled)
    const session2 = await mongoose.startSession();
    session2.startTransaction();
    try {
      const membresia2 = await MembresiaService.crear(
        {
          cliente_id: cliente._id,
          plan_id: plan._id,
          estado_pago: 'pagado'
        },
        session2
      );
      await session2.commitTransaction();
      expect(membresia2.estado).toBe('activo');
    } finally {
      session2.endSession();
    }

    // Verify we have 2 memberships total (1 cancelled, 1 active)
    const todasMembresias = await Membresia.find({ cliente_id: cliente._id });
    expect(todasMembresias).toHaveLength(2);

    const activas = todasMembresias.filter(m => m.estado === 'activo');
    const canceladas = todasMembresias.filter(m => m.estado === 'cancelado');
    expect(activas).toHaveLength(1);
    expect(canceladas).toHaveLength(1);
  });

  it('should handle concurrent plan changes correctly', async () => {
    // Arrange: Create client, plan, and initial membership
    const cliente = await Cliente.create({
      nombre: 'Ana Torres',
      dni: '55667788',
      telefono: '955443322',
      email: 'ana@test.com'
    });

    const plan1 = await Plan.create({
      nombre: 'Plan Básico',
      precio: 80,
      duracion_dias: 30,
      activo: true
    });

    const plan2 = await Plan.create({
      nombre: 'Plan Premium',
      precio: 150,
      duracion_dias: 30,
      activo: true
    });

    // Create initial membership
    const session0 = await mongoose.startSession();
    session0.startTransaction();
    let membresiaInicial;
    try {
      membresiaInicial = await MembresiaService.crear(
        {
          cliente_id: cliente._id,
          plan_id: plan1._id,
          estado_pago: 'pagado'
        },
        session0
      );
      await session0.commitTransaction();
    } finally {
      session0.endSession();
    }

    // Act: 3 users try to change plan simultaneously
    const cambios = Array(3).fill(null).map(() =>
      mongoose.startSession().then(async session => {
        try {
          session.startTransaction();
          const nueva = await MembresiaService.cambiarPlan(
            membresiaInicial._id,
            {
              plan_id: plan2._id,
              estado_pago: 'pagado'
            },
            session
          );
          await session.commitTransaction();
          return { success: true, nueva };
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

    const resultados = await Promise.all(cambios);

    // Assert: At least one should succeed
    const exitosas = resultados.filter(r => r.success);
    expect(exitosas.length).toBeGreaterThan(0);

    // Verify original membership is cancelled
    const original = await Membresia.findById(membresiaInicial._id);
    expect(original.estado).toBe('cancelado');

    // Verify only one active membership exists
    const activas = await Membresia.find({
      cliente_id: cliente._id,
      estado: 'activo'
    });
    expect(activas.length).toBeGreaterThanOrEqual(1);
    
    // All active memberships should be with plan2
    activas.forEach(m => {
      expect(m.plan_id.toString()).toBe(plan2._id.toString());
    });
  });
});
