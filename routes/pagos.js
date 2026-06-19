const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const Pago = require('../models/Pago');
const Membresia = require('../models/Membresia');
const Caja = require('../models/Caja');
const { verifyToken, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validators, handleValidationErrors } = require('../middleware/validation');

router.use(verifyToken);

// ── POST /abono — registrar abono parcial para una membresía ────────────────
router.post(
  '/abono',
  [
    body('membresia_id').isMongoId().withMessage('membresia_id inválido.'),
    body('monto').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a 0.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    body('caja_id').isMongoId().withMessage('caja_id inválido.'),
    handleValidationErrors
  ],
  async (req, res) => {
    const { membresia_id, monto, metodo_pago, caja_id, notas } = req.body;
    try {
      const caja = await Caja.findOne({ _id: caja_id, estado: 'abierta' });
      if (!caja) return res.status(400).json({ error: 'La caja no está abierta.' });

      const membresia = await Membresia.findById(membresia_id).populate('plan_id');
      if (!membresia) return res.status(404).json({ error: 'Membresía no encontrada.' });

      const totalPlan = membresia.monto_total;

      const pagosExistentes = await Pago.find({ membresia_id, estado: 'pagado' });
      const totalPagado = pagosExistentes.reduce((sum, p) => sum + p.monto, 0);

      if (totalPagado >= totalPlan) {
        return res.status(400).json({ error: 'Esta membresía ya está pagada completamente.' });
      }

      if (totalPagado + monto > totalPlan) {
        return res.status(400).json({
          error: `El monto excede el saldo pendiente. Saldo restante: S/ ${(totalPlan - totalPagado).toFixed(2)}`
        });
      }

      const numeroAbono = pagosExistentes.length + 1;

      const [pago] = await Pago.create([{
        cliente_id: membresia.cliente_id,
        membresia_id,
        caja_id,
        monto,
        metodo_pago: metodo_pago || 'efectivo',
        estado: 'pagado',
        notas: notas || `Abono ${numeroAbono} de ${totalPlan.toFixed(2)}`,
        es_abono: true,
        numero_abono: numeroAbono,
        total_esperado: totalPlan
      }]);

      const nuevoTotalPagado = totalPagado + monto;
      const completado = nuevoTotalPagado >= totalPlan;

      if (membresia.estado === 'pendiente') {
        await Membresia.findByIdAndUpdate(membresia_id, { $set: { estado: 'activo' } });
      }

      res.status(201).json({
        pago,
        resumen: {
          total_plan: totalPlan,
          total_pagado: nuevoTotalPagado,
          pendiente: Math.max(totalPlan - nuevoTotalPagado, 0),
          completado
        }
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ── GET /:membresia_id/estado-pago — consultar estado de pagos de una membresía ─
router.get('/:membresia_id/estado-pago', [
  validators.mongoId('membresia_id'),
  handleValidationErrors
], async (req, res) => {
  try {
    const membresia = await Membresia.findById(req.params.membresia_id).populate('plan_id');
    if (!membresia) return res.status(404).json({ error: 'Membresía no encontrada.' });

    const pagos = await Pago.find({ membresia_id: req.params.membresia_id, estado: 'pagado' })
      .sort({ fecha_pago: 1 });

    const totalPlan = membresia.monto_total || membresia.plan_id.precio;
    const totalPagado = pagos.reduce((sum, p) => sum + p.monto, 0);

    res.json({
      total_plan: totalPlan,
      total_pagado: totalPagado,
      pendiente: Math.max(totalPlan - totalPagado, 0),
      completado: totalPagado >= totalPlan,
      pagos: pagos.map(p => ({
        id: p._id,
        monto: p.monto,
        metodo_pago: p.metodo_pago,
        fecha_pago: p.fecha_pago,
        numero_abono: p.numero_abono,
        es_abono: p.es_abono
      }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET / — listar pagos ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { cliente_id, estado, metodo_pago, from, to, page = 1, limit = 20 } = req.query;
  const filter = {};

  if (cliente_id)  filter.cliente_id = cliente_id;
  if (estado)      filter.estado = estado;
  if (metodo_pago) filter.metodo_pago = metodo_pago;
  if (from || to) {
    filter.fecha_pago = {};
    if (from) filter.fecha_pago.$gte = new Date(from);
    if (to)   filter.fecha_pago.$lte = new Date(to);
  }

  try {
    const total = await Pago.countDocuments(filter);
    const pagos = await Pago.find(filter)
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } })
      .sort({ fecha_pago: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const data = pagos.map(p => ({
      ...p.toObject(),
      id: p._id,
      cliente_nombre: [p.cliente_id?.nombre, p.cliente_id?.apellido_paterno, p.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
      plan_nombre: p.membresia_id?.plan_id?.nombre,
      plan_precio: p.membresia_id?.plan_id?.precio,
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/confirmar — confirmar pago pendiente (requiere caja abierta) ─────
router.put(
  '/:id/confirmar',
  [
    validators.mongoId('id'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    body('caja_id').isMongoId().withMessage('caja_id inválido. Abre la caja antes de confirmar pagos.'),
    handleValidationErrors
  ],
  async (req, res) => {
    const { metodo_pago, caja_id } = req.body;
    try {
      // Verificar que la caja esté abierta
      const caja = await Caja.findOne({ _id: caja_id, estado: 'abierta' });
      if (!caja) {
        return res.status(400).json({ error: 'La caja indicada no existe o ya fue cerrada. Abre una caja antes de confirmar pagos.' });
      }

      const pago = await Pago.findById(req.params.id);
      if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' });
      if (pago.estado === 'pagado') return res.status(400).json({ error: 'Este pago ya fue confirmado.' });

      const update = { estado: 'pagado', caja_id };
      if (metodo_pago) update.metodo_pago = metodo_pago;
      await Pago.findByIdAndUpdate(req.params.id, update, { new: true });
      const pagoActualizado = await Pago.findById(req.params.id)
        .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
        .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } });

      if (pago.membresia_id) {
        await Membresia.findOneAndUpdate(
          { _id: pago.membresia_id, estado: 'pendiente' },
          { $set: { estado: 'activo' } }
        );
      }

      // Devolver con el mismo shape que GET /pagos para que el caché del frontend
      // pueda hacer patch quirúrgico sin perder cliente_nombre ni plan_nombre
      res.json({
        ...pagoActualizado.toObject(),
        id: pagoActualizado._id,
        cliente_nombre: [pagoActualizado.cliente_id?.nombre, pagoActualizado.cliente_id?.apellido_paterno, pagoActualizado.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
        plan_nombre: pagoActualizado.membresia_id?.plan_id?.nombre,
        plan_precio: pagoActualizado.membresia_id?.plan_id?.precio,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ── PUT /:id — editar pago (solo admin) ───────────────────────────────────────
router.put(
  '/:id',
  requireRole('admin'),
  [
    validators.mongoId('id'),
    validators.monto('monto').optional(),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    body('estado').optional().isIn(['pagado', 'pendiente']).withMessage('Estado inválido.'),
    handleValidationErrors
  ],
  async (req, res) => {
    const { monto, metodo_pago, estado, notas } = req.body;
    try {
      const pago = await Pago.findByIdAndUpdate(
        req.params.id,
        { monto, metodo_pago, estado, notas },
        { new: true }
      );
      if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' });
      res.json(pago);
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ── DELETE /:id — eliminar pago (solo admin) ──────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const pago = await Pago.findByIdAndDelete(req.params.id);
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' });
    res.json({ message: 'Pago eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
