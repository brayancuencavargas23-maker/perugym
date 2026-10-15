const router = require('express').Router();
const { body, query } = require('express-validator');
const { requireRole } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');
const { validators, handleValidationErrors } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const execute = require('../utils/membresiaTransaction');
const Pagos = require('../services/MembresiaPagosService');
const Membresia = require('../models/Membresia');
const Pago = require('../models/Pago');

router.post('/abono', requireRole('admin', 'recepcionista'), requireCajaAbierta, [
  body('membresia_id').isMongoId(), body('periodo_id').optional({ nullable: true }).isMongoId(),
  body('monto').isFloat({ min: 0.01 }),
  body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  const { membresia_id, periodo_id, monto, metodo_pago, notas } = req.body;
  const result = await execute(session => Pagos.abonar({ membresia_id, periodo_id,
    monto: Number(monto), metodo_pago, notas, caja_id: req.cajaActual._id }, session));
  const pago = await Pago.findById(result.pago._id).populate('cliente_id', 'nombre apellido_paterno apellido_materno')
    .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } });
  result.pago = Pagos.presentarPago(pago);
  res.status(201).json(result);
}));

router.get('/:membresia_id/estado-pago', [validators.mongoId('membresia_id'),
  query('periodo_id').optional().isMongoId(), handleValidationErrors], asyncHandler(async (req, res) => {
  const mem = await Membresia.findById(req.params.membresia_id);
  if (!mem) return res.status(404).json({ error: 'Membresía no encontrada.' });
  const result = await Pagos.resumen(mem, req.query.periodo_id);
  delete result.actuales;
  res.json(result);
}));

router.put('/:id/confirmar', requireRole('admin', 'recepcionista'), requireCajaAbierta, [
  validators.mongoId('id'),
  body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  await execute(session => Pagos.confirmar(req.params.id, {
    caja_id: req.cajaActual._id, metodo_pago: req.body.metodo_pago,
  }, session));
  const pago = await Pago.findById(req.params.id).populate('cliente_id', 'nombre apellido_paterno apellido_materno')
    .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } });
  res.json(Pagos.presentarPago(pago));
}));

module.exports = router;
