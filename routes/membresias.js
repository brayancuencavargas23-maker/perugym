const router = require('express').Router();
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const Pago = require('../models/Pago');
const { verifyToken } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');

router.use(verifyToken);

// ── Helper: vencer membresías expiradas ──────────────────────────────────────
async function autoVencer() {
  await Membresia.updateMany(
    { fecha_fin: { $lt: new Date() }, estado: 'activo' },
    { $set: { estado: 'vencido' } }
  );
}

// ── GET / — listar membresías ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { cliente_id, estado, vencen_pronto, nombre, page = 1, limit = 20 } = req.query;
  const filter = {};

  try {
    await autoVencer();

    if (cliente_id) filter.cliente_id = cliente_id;
    if (estado) filter.estado = estado;
    if (vencen_pronto === 'true') {
      const now = new Date();
      const in7 = new Date(); in7.setDate(in7.getDate() + 7);
      filter.fecha_fin = { $gte: now, $lte: in7 };
      filter.estado = 'activo';
    }

    // Filtro por nombre de cliente: buscar primero los clientes que coincidan
    if (nombre) {
      const Cliente = require('../models/Cliente');
      const clientes = await Cliente.find(
        { nombre: { $regex: nombre, $options: 'i' } },
        '_id'
      );
      filter.cliente_id = { $in: clientes.map(c => c._id) };
    }

    const total = await Membresia.countDocuments(filter);
    const mems = await Membresia.find(filter)
      .populate('cliente_id', 'nombre foto_url')
      .populate('plan_id', 'nombre precio')
      .sort({ fecha_fin: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const data = mems.map(m => ({
      ...m.toObject(),
      id: m._id,
      cliente_nombre: m.cliente_id?.nombre,
      foto_url: m.cliente_id?.foto_url,
      plan_nombre: m.plan_id?.nombre,
      precio: m.plan_id?.precio,
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /suscribir — crea membresía + pago (requiere caja abierta) ───────────
router.post(
  '/suscribir',
  requireCajaAbierta,
  [
    body('cliente_id').isMongoId().withMessage('cliente_id inválido.'),
    body('plan_id').isMongoId().withMessage('plan_id inválido.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    body('estado_pago').optional().isIn(['pagado', 'pendiente']).withMessage('Estado de pago inválido.'),
    body('fecha_inicio').optional().isISO8601().withMessage('Fecha de inicio inválida.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { cliente_id, plan_id, fecha_inicio, metodo_pago, estado_pago = 'pagado', notas } = req.body;
    const caja_id = req.cajaActual._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await autoVencer();

      const activa = await Membresia.findOne({ cliente_id, estado: 'activo' }).session(session);
      if (activa) {
        await session.abortTransaction();
        return res.status(409).json({ error: 'El cliente ya tiene una membresía activa. Cancélala o espera que venza antes de asignar una nueva.' });
      }

      const plan = await Plan.findOne({ _id: plan_id, activo: true }).session(session);
      if (!plan) {
        await session.abortTransaction();
        return res.status(404).json({ error: 'Plan no encontrado o inactivo.' });
      }

      const inicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + plan.duracion_dias);

      const estadoMembresia = estado_pago === 'pendiente' ? 'pendiente' : 'activo';

      const [membresia] = await Membresia.create(
        [{ cliente_id, plan_id, fecha_inicio: inicio, fecha_fin: fin, estado: estadoMembresia }],
        { session }
      );
      const [pago] = await Pago.create(
        [{ cliente_id, membresia_id: membresia._id, caja_id, monto: plan.precio, metodo_pago: metodo_pago || 'efectivo', estado: estado_pago, notas: notas || null }],
        { session }
      );

      await session.commitTransaction();
      res.status(201).json({ membresia, pago });
    } catch (err) {
      await session.abortTransaction();
      res.status(500).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// ── POST /:id/cambiar-plan (requiere caja abierta) ────────────────────────────
router.post(
  '/:id/cambiar-plan',
  requireCajaAbierta,
  [
    param('id').isMongoId().withMessage('ID de membresía inválido.'),
    body('plan_id').isMongoId().withMessage('plan_id inválido.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
    body('estado_pago').optional().isIn(['pagado', 'pendiente']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { plan_id, fecha_inicio, metodo_pago, estado_pago = 'pagado', notas } = req.body;
    const caja_id = req.cajaActual._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const mem = await Membresia.findById(req.params.id).session(session);
      if (!mem) { await session.abortTransaction(); return res.status(404).json({ error: 'Membresía no encontrada.' }); }
      if (mem.estado !== 'activo' && mem.estado !== 'pendiente') {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Solo se puede cambiar el plan de una membresía activa o pendiente.' });
      }

      const plan = await Plan.findOne({ _id: plan_id, activo: true }).session(session);
      if (!plan) { await session.abortTransaction(); return res.status(404).json({ error: 'Plan no encontrado o inactivo.' }); }

      await Membresia.findByIdAndUpdate(req.params.id, { estado: 'cancelado' }, { session });

      const inicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + plan.duracion_dias);
      const estadoMembresia = estado_pago === 'pendiente' ? 'pendiente' : 'activo';

      const [nueva] = await Membresia.create(
        [{ cliente_id: mem.cliente_id, plan_id, fecha_inicio: inicio, fecha_fin: fin, estado: estadoMembresia }],
        { session }
      );
      const [pago] = await Pago.create(
        [{ cliente_id: mem.cliente_id, membresia_id: nueva._id, caja_id, monto: plan.precio, metodo_pago: metodo_pago || 'efectivo', estado: estado_pago, notas: notas || null }],
        { session }
      );

      await session.commitTransaction();
      res.status(201).json({ membresia: nueva, pago });
    } catch (err) {
      await session.abortTransaction();
      res.status(500).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// ── POST /:id/renovar (requiere caja abierta) ─────────────────────────────────
router.post(
  '/:id/renovar',
  requireCajaAbierta,
  [
    param('id').isMongoId().withMessage('ID de membresía inválido.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
    body('estado_pago').optional().isIn(['pagado', 'pendiente']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { metodo_pago, estado_pago = 'pagado', notas } = req.body;
    const caja_id = req.cajaActual._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await autoVencer();

      const mem = await Membresia.findById(req.params.id).populate('plan_id').session(session);
      if (!mem) { await session.abortTransaction(); return res.status(404).json({ error: 'Membresía no encontrada.' }); }
      if (mem.estado === 'activo') { await session.abortTransaction(); return res.status(400).json({ error: 'La membresía aún está activa. No es necesario renovar.' }); }

      const otraActiva = await Membresia.findOne({ cliente_id: mem.cliente_id, estado: 'activo' }).session(session);
      if (otraActiva) { await session.abortTransaction(); return res.status(409).json({ error: 'El cliente ya tiene una membresía activa.' }); }

      const inicio = new Date();
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + mem.plan_id.duracion_dias);
      const estadoMembresia = estado_pago === 'pendiente' ? 'pendiente' : 'activo';

      const [nueva] = await Membresia.create(
        [{ cliente_id: mem.cliente_id, plan_id: mem.plan_id._id, fecha_inicio: inicio, fecha_fin: fin, estado: estadoMembresia }],
        { session }
      );
      const [pago] = await Pago.create(
        [{ cliente_id: mem.cliente_id, membresia_id: nueva._id, caja_id, monto: mem.plan_id.precio, metodo_pago: metodo_pago || 'efectivo', estado: estado_pago, notas: notas || null }],
        { session }
      );

      await session.commitTransaction();
      res.status(201).json({ membresia: nueva, pago });
    } catch (err) {
      await session.abortTransaction();
      res.status(500).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// ── PUT /:id — actualizar estado manualmente ──────────────────────────────────
router.put('/:id', [
  param('id').isMongoId().withMessage('ID de membresía inválido.'),
  body('estado').optional().isIn(['activo', 'vencido', 'cancelado', 'pendiente']).withMessage('Estado inválido.'),
  body('fecha_fin').optional().isISO8601().withMessage('Fecha fin inválida.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { estado, fecha_fin } = req.body;
  try {
    const update = {};
    if (estado) update.estado = estado;
    if (fecha_fin) update.fecha_fin = fecha_fin;
    const mem = await Membresia.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('cliente_id', 'nombre foto_url')
      .populate('plan_id', 'nombre precio');
    if (!mem) return res.status(404).json({ error: 'Membresía no encontrada.' });
    // Devolver con el mismo shape que GET /membresias para que el patch del caché funcione
    res.json({
      ...mem.toObject(),
      id: mem._id,
      cliente_nombre: mem.cliente_id?.nombre,
      foto_url: mem.cliente_id?.foto_url,
      plan_nombre: mem.plan_id?.nombre,
      precio: mem.plan_id?.precio,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /:id — cancelar membresía ─────────────────────────────────────────
router.delete('/:id', [
  param('id').isMongoId().withMessage('ID de membresía inválido.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  try {
    const mem = await Membresia.findById(req.params.id);
    if (!mem) return res.status(404).json({ error: 'Membresía no encontrada.' });
    if (mem.estado === 'cancelado') return res.status(400).json({ error: 'La membresía ya está cancelada.' });
    mem.estado = 'cancelado';
    await mem.save();
    res.json({ message: 'Membresía cancelada correctamente.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /:id/pagos — historial de pagos de una membresía ─────────────────────
router.get('/:id/pagos', [
  param('id').isMongoId().withMessage('ID de membresía inválido.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  try {
    const pagos = await Pago.find({ membresia_id: req.params.id })
      .populate('cliente_id', 'nombre')
      .sort({ fecha_pago: -1 });
    const data = pagos.map(p => ({
      ...p.toObject(),
      id: p._id,
      cliente_nombre: p.cliente_id?.nombre,
    }));
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /vencer — auto-vencer membresías expiradas ───────────────────────────
router.post('/vencer', async (req, res) => {
  try {
    const result = await Membresia.updateMany(
      { fecha_fin: { $lt: new Date() }, estado: 'activo' },
      { $set: { estado: 'vencido' } }
    );
    res.json({ actualizadas: result.modifiedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
