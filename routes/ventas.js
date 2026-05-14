const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const Venta = require('../models/Venta');
const Producto = require('../models/Producto');
const { verifyToken, requireRole } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');
const { asyncHandler } = require('../middleware/errorHandler');
const { validators, handleValidationErrors } = require('../middleware/validation');
const TransactionManager = require('../utils/TransactionManager');
const StockService = require('../services/StockService');

router.use(verifyToken);

// ── Registrar venta desde caja ────────────────────────────────────────────────
router.post(
  '/',
  requireCajaAbierta,
  [
    body('items').isArray({ min: 1 }).withMessage('Se requiere al menos un producto.'),
    body('items.*.producto_id').isMongoId().withMessage('producto_id inválido.'),
    body('items.*.cantidad').isInt({ min: 1 }).withMessage('La cantidad debe ser un entero positivo.'),
    body('cliente_id').optional({ nullable: true }).isMongoId().withMessage('cliente_id inválido.'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { cliente_id, items, metodo_pago } = req.body;
    const caja_id = req.cajaActual._id; // inyectado por requireCajaAbierta

    const venta = await TransactionManager.execute(async (session) => {
      // Descontar stock de múltiples productos de forma atómica
      const ventaItems = await StockService.descontarMultiple(items, session);

      // Crear venta
      const [nuevaVenta] = await Venta.create(
        [{ 
          caja_id, 
          cliente_id: cliente_id || null, 
          metodo_pago: metodo_pago || 'efectivo', 
          items: ventaItems 
        }],
        { session }
      );

      return nuevaVenta;
    });

    res.status(201).json(venta);
  })
);

// ── Anular venta — revierte stock y marca como anulada ────────────────────────
router.put('/:id/anular', requireRole('admin', 'recepcionista'), asyncHandler(async (req, res) => {
  const result = await TransactionManager.execute(async (session) => {
    const venta = await Venta.findById(req.params.id).session(session);
    if (!venta) {
      throw new Error('Venta no encontrada');
    }
    if (venta.anulada) {
      throw new Error('La venta ya está anulada');
    }

    // Revertir stock de múltiples productos de forma atómica
    await StockService.revertirMultiple(venta.items, session);

    // Marcar venta como anulada
    await Venta.findByIdAndUpdate(
      req.params.id,
      { anulada: true, anulada_at: new Date() },
      { session }
    );

    // Devolver los productos con stock actualizado para que el frontend
    // pueda hacer patch quirúrgico del caché sin invalidar toda la lista
    const productosActualizados = await Producto.find({
      _id: { $in: venta.items.map(i => i.producto_id) }
    });

    return { message: 'Venta anulada correctamente', productos: productosActualizados };
  });

  res.json(result);
}));

module.exports = router;
