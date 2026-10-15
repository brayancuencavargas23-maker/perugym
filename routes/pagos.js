const router = require('express').Router();
const { body } = require('express-validator');
const Pago = require('../models/Pago');
const { verifyToken, requireRole } = require('../middleware/auth');
const { validators, handleValidationErrors } = require('../middleware/validation');
const { presentarPago } = require('../services/MembresiaPagosService');

router.use(verifyToken);
router.use(require('./membresiaPagos'));

router.get('/', async (req, res) => {
  const { cliente_id, estado, metodo_pago, from, to, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (cliente_id) filter.cliente_id = cliente_id;
  if (estado) filter.estado = estado;
  if (metodo_pago) filter.metodo_pago = metodo_pago;
  if (from || to) {
    filter.fecha_pago = {};
    if (from) filter.fecha_pago.$gte = new Date(from);
    if (to) filter.fecha_pago.$lte = new Date(to);
  }
  const size = Math.min(500, Math.max(1, parseInt(limit) || 20));
  const current = Math.max(1, parseInt(page) || 1);
  try {
    const total = await Pago.countDocuments(filter);
    const pagos = await Pago.find(filter)
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } })
      .sort({ fecha_pago: -1 }).skip((current - 1) * size).limit(size);
    res.json({ data: pagos.map(presentarPago), total, page: current, pages: Math.ceil(total / size) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireRole('admin'), [
  validators.mongoId('id'), validators.monto('monto').optional(),
  body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
  body('estado').optional().isIn(['pagado', 'pendiente']), handleValidationErrors,
], async (req, res) => {
  const { monto, metodo_pago, estado, notas } = req.body;
  try {
    const pago = await Pago.findByIdAndUpdate(req.params.id, { monto, metodo_pago, estado, notas }, { new: true });
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' });
    res.json(pago);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const pago = await Pago.findByIdAndDelete(req.params.id);
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' });
    res.json({ message: 'Pago eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
