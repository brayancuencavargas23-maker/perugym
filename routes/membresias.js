const router = require('express').Router();
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const Pago = require('../models/Pago');
const { verifyToken } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');
const { asyncHandler } = require('../middleware/errorHandler');
const { validators, handleValidationErrors } = require('../middleware/validation');
const MembresiaService = require('../services/MembresiaService');
const TransactionManager = require('../utils/TransactionManager');

router.use(verifyToken);

// ── GET / — listar membresías ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { cliente_id, estado, vencen_pronto, nombre, page = 1, limit = 20 } = req.query;
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
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno foto_url')
      .populate('plan_id', 'nombre precio')
      .sort({ fecha_fin: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const membresiaIds = mems.map(m => m._id);
    const pagosAgrupados = await Pago.aggregate([
      { $match: { membresia_id: { $in: membresiaIds }, estado: 'pagado' } },
      { $group: {
        _id: '$membresia_id',
        total_pagado: { $sum: '$monto' },
        cantidad_abonos: { $sum: 1 }
      }}
    ]);
    const pagosMap = {};
    pagosAgrupados.forEach(p => { pagosMap[p._id.toString()] = p; });

    const data = mems.map(m => {
      const pagoInfo = pagosMap[m._id.toString()] || { total_pagado: 0, cantidad_abonos: 0 };
      return {
        ...m.toObject(),
        id: m._id,
        cliente_nombre: [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno, m.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
        foto_url: m.cliente_id?.foto_url,
        plan_nombre: m.plan_id?.nombre,
        precio: m.monto_total || m.plan_id?.precio,
        precio_original: m.plan_id?.precio,
        total_pagado: pagoInfo.total_pagado,
        cantidad_abonos: pagoInfo.cantidad_abonos,
      };
    });

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

// ── POST /:id/renovar (requiere caja abierta) ─────────────────────────────────
router.post(
  '/:id/renovar',
  requireCajaAbierta,
  [
    validators.mongoId('id'),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']).withMessage('Método de pago inválido.'),
    body('estado_pago').optional().isIn(['pagado', 'pendiente']).withMessage('Estado de pago inválido.'),
    body('descuento').optional().isFloat({ min: 0 }).withMessage('El descuento debe ser un número positivo.'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { metodo_pago, estado_pago = 'pagado', notas, descuento = 0 } = req.body;
    const caja_id = req.cajaActual._id;

    await MembresiaService.autoVencer();

    const result = await TransactionManager.execute(async (session) => {
      // Get current membership to know the plan price
      const memActual = await Membresia.findById(req.params.id)
        .populate('plan_id')
        .session(session);

      // Apply discount
      const descuentoAplicado = Math.min(parseFloat(descuento) || 0, memActual.plan_id.precio);
      const montoFinal = Math.max(memActual.plan_id.precio - descuentoAplicado, 0);

      // Renew membership using service
      const nueva = await MembresiaService.renovar(
        req.params.id,
        estado_pago,
        session,
        montoFinal
      );

      // Get plan for payment amount
      const mem = await Membresia.findById(nueva._id)
        .populate('plan_id')
        .session(session);

      const notasConDescuento = descuentoAplicado > 0
        ? [notas, `Descuento aplicado: S/ ${descuentoAplicado.toFixed(2)} (precio original: S/ ${memActual.plan_id.precio.toFixed(2)})`].filter(Boolean).join(' | ')
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
    const update = {};
    if (estado) update.estado = estado;
    if (fecha_fin) update.fecha_fin = fecha_fin;
    await Membresia.findByIdAndUpdate(req.params.id, update, { new: true });
    const mem = await Membresia.findById(req.params.id)
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno foto_url')
      .populate('plan_id', 'nombre precio');
    if (!mem) return res.status(404).json({ error: 'Membresía no encontrada.' });
    // Devolver con el mismo shape que GET /membresias para que el patch del caché funcione
    res.json({
      ...mem.toObject(),
      id: mem._id,
      cliente_nombre: [mem.cliente_id?.nombre, mem.cliente_id?.apellido_paterno, mem.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
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
    mem.estado = 'cancelado';
    await mem.save();
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
      .sort({ fecha_pago: -1 });
    const data = pagos.map(p => ({
      ...p.toObject(),
      id: p._id,
      cliente_nombre: [p.cliente_id?.nombre, p.cliente_id?.apellido_paterno, p.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
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
