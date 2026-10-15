const router = require('express').Router();
const { body } = require('express-validator');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const Pago = require('../models/Pago');
const { verifyToken } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');
const { asyncHandler } = require('../middleware/errorHandler');
const { validators, handleValidationErrors } = require('../middleware/validation');
const MembresiaService = require('../services/MembresiaService');
const TransactionManager = require('../utils/TransactionManager');
const Consultas = require('../services/MembresiaConsultaService');
const { presentarPago } = require('../services/MembresiaPagosService');
const { versionFiltro } = require('../utils/membresiaPeriodos');

router.use(verifyToken);
router.use(require('./membresiaRenovaciones'));

// ── GET / — listar membresías ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { cliente_id, estado, vencen_pronto, nombre } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 20));
  const filter = {};

  try {
    await MembresiaService.autoVencer();

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
      const safeNombre = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regexNombre = { $regex: safeNombre, $options: 'i' };
      const clientes = await Cliente.find(
        {
          $or: [
            { nombre: regexNombre },
            { apellido_paterno: regexNombre },
            { apellido_materno: regexNombre },
          ]
        },
        '_id'
      );
      filter.cliente_id = { $in: clientes.map(c => c._id) };
    }

    const total = await Membresia.countDocuments(filter);
    const mems = await Membresia.find(filter)
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno foto_url telefono')
      .populate('plan_id', 'nombre precio')
      .sort({ fecha_fin: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const data = await Consultas.listar(mems);

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
    body('descuento').optional().isFloat({ min: 0 }).withMessage('El descuento debe ser un número positivo.'),
    body('monto').optional().isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a 0.'),
    validators.fecha('fecha_inicio'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { cliente_id, plan_id, fecha_inicio, fecha_fin, metodo_pago, estado_pago = 'pagado', notas, descuento = 0, monto } = req.body;
    const caja_id = req.cajaActual._id;

    await MembresiaService.autoVencer();

    const result = await TransactionManager.execute(async (session) => {
      const plan = await Plan.findById(plan_id).session(session);
      if (!plan) throw new Error('Plan no encontrado');

      const descuentoAplicado = Math.min(parseFloat(descuento) || 0, plan.precio);
      const montoPlan = Math.max(plan.precio - descuentoAplicado, 0);
      const montoIngresado = monto ? parseFloat(monto) : montoPlan;
      const esAbono = montoIngresado < montoPlan;

      const membresiaEstado = esAbono ? 'activo' : (estado_pago === 'pagado' ? 'activo' : 'pendiente');

      const membresia = await MembresiaService.crear(
        { cliente_id, plan_id, fecha_inicio, fecha_fin, estado_pago: membresiaEstado === 'activo' ? 'pagado' : 'pendiente', monto_total: montoPlan },
        session
      );

      const notasConDescuento = descuentoAplicado > 0
        ? [notas, `Descuento aplicado: S/ ${descuentoAplicado.toFixed(2)} (precio original: S/ ${plan.precio.toFixed(2)})`].filter(Boolean).join(' | ')
        : notas || null;

      const notasAbono = esAbono
        ? [notasConDescuento, `Abono 1 de ${montoPlan.toFixed(2)}`].filter(Boolean).join(' | ')
        : notasConDescuento;

      const [pago] = await Pago.create(
        [{
          cliente_id,
          membresia_id: membresia._id,
          caja_id,
          monto: montoIngresado,
          metodo_pago: metodo_pago || 'efectivo',
          estado: esAbono ? 'pagado' : estado_pago,
          notas: notasAbono,
          es_abono: esAbono,
          numero_abono: esAbono ? 1 : null,
          total_esperado: esAbono ? montoPlan : null
        }],
        { session }
      );

      return { membresia, pago, es_abono: esAbono, total_plan: montoPlan };
    });

    res.status(201).json(result);
  })
);

// ── POST /:id/cambiar-plan (requiere caja abierta) ────────────────────────────
router.post(
  '/:id/cambiar-plan',
  requireCajaAbierta,
  [
    validators.mongoId('id'),
    body('plan_id').isMongoId().withMessage('plan_id inválido.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    body('estado_pago').optional().isIn(['pagado', 'pendiente']).withMessage('Estado de pago inválido.'),
    body('descuento').optional().isFloat({ min: 0 }).withMessage('El descuento debe ser un número positivo.'),
    validators.fecha('fecha_inicio'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { plan_id, fecha_inicio, metodo_pago, estado_pago = 'pagado', notas, descuento = 0 } = req.body;
    const caja_id = req.cajaActual._id;

    const result = await TransactionManager.execute(async (session) => {
      // Get plan for discount calculation
      const plan = await Plan.findById(plan_id).session(session);

      // Apply discount
      const descuentoAplicado = Math.min(parseFloat(descuento) || 0, plan.precio);
      const montoFinal = Math.max(plan.precio - descuentoAplicado, 0);

      // Change plan using service
      const nueva = await MembresiaService.cambiarPlan(
        req.params.id,
        { plan_id, fecha_inicio, estado_pago, monto_total: montoFinal },
        session
      );

      // Get client ID from new membership
      const mem = await Membresia.findById(nueva._id).session(session);

      const notasConDescuento = descuentoAplicado > 0
        ? [notas, `Descuento aplicado: S/ ${descuentoAplicado.toFixed(2)} (precio original: S/ ${plan.precio.toFixed(2)})`].filter(Boolean).join(' | ')
        : notas || null;

      // Create payment
      const [pago] = await Pago.create(
        [{
          cliente_id: mem.cliente_id,
          membresia_id: nueva._id,
          caja_id,
          monto: montoFinal,
          metodo_pago: metodo_pago || 'efectivo',
          estado: estado_pago,
          notas: notasConDescuento
        }],
        { session }
      );

      return { membresia: nueva, pago };
    });

    res.status(201).json(result);
  })
);

// ── PUT /:id — actualizar estado manualmente ──────────────────────────────────
router.put('/:id', [
  validators.mongoId('id'),
  body('estado').optional().isIn(['activo', 'vencido', 'cancelado', 'pendiente']).withMessage('Estado inválido.'),
  validators.fecha('fecha_fin'),
  handleValidationErrors
], async (req, res) => {
  const { estado, fecha_fin } = req.body;
  try {
    const actual = await Membresia.findById(req.params.id);
    if (actual?.periodos?.length) return res.status(400).json({ error: 'Usa Renovar para modificar fechas o plan sin alterar los periodos contratados.' });
    const update = {};
    if (estado) update.estado = estado;
    if (fecha_fin) update.fecha_fin = fecha_fin;
    await Membresia.findByIdAndUpdate(req.params.id, update, { new: true });
    const mem = await Membresia.findById(req.params.id)
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno foto_url telefono')
      .populate('plan_id', 'nombre precio');
    if (!mem) return res.status(404).json({ error: 'Membresía no encontrada.' });
    // Devolver con el mismo shape que GET /membresias para que el patch del caché funcione
    res.json({
      ...mem.toObject(),
      id: mem._id,
      cliente_nombre: [mem.cliente_id?.nombre, mem.cliente_id?.apellido_paterno, mem.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
      cliente_telefono: mem.cliente_id?.telefono || null,
      foto_url: mem.cliente_id?.foto_url,
      plan_nombre: mem.plan_id?.nombre,
      precio: mem.plan_id?.precio,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /:id — cancelar membresía ─────────────────────────────────────────
router.delete('/:id', [
  validators.mongoId('id'),
  handleValidationErrors
], async (req, res) => {
  try {
    const mem = await Membresia.findById(req.params.id);
    if (!mem) return res.status(404).json({ error: 'Membresía no encontrada.' });
    if (mem.estado === 'cancelado') return res.status(400).json({ error: 'La membresía ya está cancelada.' });
    const cancelled = await Membresia.updateOne({ ...versionFiltro(mem), estado: mem.estado },
      { $set: { estado: 'cancelado' }, $inc: { __v: 1 } });
    if (!cancelled.modifiedCount) return res.status(409).json({ error: 'La membresía cambió. Recarga antes de cancelar.' });
    res.json({ message: 'Membresía cancelada correctamente.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /:id/pagos — historial de pagos de una membresía ─────────────────────
router.get('/:id/pagos', [
  validators.mongoId('id'),
  handleValidationErrors
], async (req, res) => {
  try {
    const pagos = await Pago.find({ membresia_id: req.params.id })
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } })
      .sort({ fecha_pago: -1 });
    const data = pagos.map(presentarPago)
      .filter(p => !req.query.periodo_id || String(p.periodo_id) === req.query.periodo_id);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /vencer — auto-vencer membresías expiradas ───────────────────────────
router.post('/vencer', async (req, res) => {
  try {
    const actualizadas = await MembresiaService.autoVencer();
    res.json({ actualizadas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
