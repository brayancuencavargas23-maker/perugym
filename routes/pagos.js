const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const Pago = require('../models/Pago');
const Membresia = require('../models/Membresia');
const Caja = require('../models/Caja');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

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
      .populate('cliente_id', 'nombre')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } })
      .sort({ fecha_pago: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const data = pagos.map(p => ({
      ...p.toObject(),
      id: p._id,
      cliente_nombre: p.cliente_id?.nombre,
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
    param('id').isMongoId().withMessage('ID de pago inválido.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    body('caja_id').isMongoId().withMessage('caja_id inválido. Abre la caja antes de confirmar pagos.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

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
      const pagoActualizado = await Pago.findByIdAndUpdate(req.params.id, update, { new: true })
        .populate('cliente_id', 'nombre')
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
        cliente_nombre: pagoActualizado.cliente_id?.nombre,
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
    param('id').isMongoId().withMessage('ID de pago inválido.'),
    body('monto').optional().isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a 0.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
    body('estado').optional().isIn(['pagado', 'pendiente']).withMessage('Estado inválido.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

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
