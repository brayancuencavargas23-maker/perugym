const router = require('express').Router();
const { body } = require('express-validator');
const { requireRole } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');
const { asyncHandler } = require('../middleware/errorHandler');
const { validators, handleValidationErrors } = require('../middleware/validation');
const execute = require('../utils/membresiaTransaction');
const Renovaciones = require('../services/MembresiaRenovacionService');
const Consultas = require('../services/MembresiaConsultaService');
const MembresiaService = require('../services/MembresiaService');

router.post('/:id/renovar', requireRole('admin', 'recepcionista'), requireCajaAbierta, [
  validators.mongoId('id'),
  body('version').isInt({ min: 0 }).withMessage('Recarga la membresía para obtener su versión.'),
  body('plan_id').isMongoId().withMessage('Selecciona un plan válido.'),
  body('precio_acordado').isFloat({ min: 0 }).withMessage('Precio acordado inválido.'),
  body('fecha_inicio').optional().isISO8601().withMessage('Fecha de inicio inválida.'),
  body('monto').optional().isFloat({ min: 0.01 }).withMessage('Abono inválido.'),
  body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
  body('estado_pago').optional().isIn(['pagado', 'pendiente']),
  body('notas').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  await MembresiaService.autoVencer();
  const { plan_id, precio_acordado, fecha_inicio, monto, metodo_pago, estado_pago, notas } = req.body;
  const result = await execute(session => Renovaciones.renovar(req.params.id, {
    plan_id, precio_acordado: Number(precio_acordado), fecha_inicio, monto, metodo_pago, estado_pago, notas,
    version: Number(req.body.version), caja_id: req.cajaActual._id, usuario_id: req.user.id,
  }, session));
  result.membresia = await Consultas.porId(result.membresia._id);
  res.status(200).json(result);
}));

router.get('/:id/periodos', [validators.mongoId('id'), handleValidationErrors], asyncHandler(async (req, res) => {
  const data = await Consultas.porId(req.params.id);
  if (!data) return res.status(404).json({ error: 'Membresía no encontrada.' });
  res.json({ membresia_id: data.id, periodos: data.periodos || [], saldo_total: data.saldo_total });
}));

router.get('/:id/detalle', [validators.mongoId('id'), handleValidationErrors], asyncHandler(async (req, res) => {
  const data = await Consultas.porId(req.params.id);
  if (!data) return res.status(404).json({ error: 'Membresía no encontrada.' });
  res.json(data);
}));

module.exports = router;
