const router = require('express').Router();
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Venta = require('../models/Venta');
const Producto = require('../models/Producto');
const { verifyToken, requireRole } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');

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
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { cliente_id, items, metodo_pago } = req.body;
    const caja_id = req.cajaActual._id; // inyectado por requireCajaAbierta

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const ventaItems = [];

      for (const item of items) {
        // Descontar stock de forma atómica: solo si hay suficiente
        const prod = await Producto.findOneAndUpdate(
          { _id: item.producto_id, activo: true, stock: { $gte: item.cantidad } },
          { $inc: { stock: -item.cantidad } },
          { new: true, session }
        );

        if (!prod) {
          // Puede ser que no exista o que no haya stock suficiente
          const existe = await Producto.findOne({ _id: item.producto_id, activo: true }).session(session);
          if (!existe) throw new Error(`Producto no encontrado o inactivo.`);
          throw new Error(`Stock insuficiente para "${existe.nombre}". Disponible: ${existe.stock}.`);
        }

        ventaItems.push({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          precio_unit: prod.precio_venta,
          subtotal: parseFloat(prod.precio_venta) * item.cantidad,
        });
      }

      const [venta] = await Venta.create(
        [{ caja_id, cliente_id: cliente_id || null, metodo_pago: metodo_pago || 'efectivo', items: ventaItems }],
        { session }
      );

      await session.commitTransaction();
      res.status(201).json(venta);
    } catch (err) {
      await session.abortTransaction();
      res.status(400).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// ── Anular venta — revierte stock y marca como anulada ────────────────────────
router.put('/:id/anular', requireRole('admin', 'recepcionista'), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const venta = await Venta.findById(req.params.id).session(session);
    if (!venta) { await session.abortTransaction(); return res.status(404).json({ error: 'Venta no encontrada' }); }
    if (venta.anulada) { await session.abortTransaction(); return res.status(400).json({ error: 'La venta ya está anulada' }); }

    // Revertir stock de forma atómica
    for (const item of venta.items) {
      await Producto.findByIdAndUpdate(
        item.producto_id,
        { $inc: { stock: item.cantidad } },
        { session }
      );
    }

    await Venta.findByIdAndUpdate(
      req.params.id,
      { anulada: true, anulada_at: new Date() },
      { session }
    );

    await session.commitTransaction();

    // Devolver los productos con stock actualizado para que el frontend
    // pueda hacer patch quirúrgico del caché sin invalidar toda la lista
    const productosActualizados = await Producto.find({
      _id: { $in: venta.items.map(i => i.producto_id) }
    });

    res.json({ message: 'Venta anulada correctamente', productos: productosActualizados });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
