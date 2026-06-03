const router = require('express').Router();
const Caja = require('../models/Caja');
const Pago = require('../models/Pago');
const Venta = require('../models/Venta');
const MovimientoCaja = require('../models/MovimientoCaja');
const { verifyToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const CajaService = require('../services/CajaService');
const TransactionManager = require('../utils/TransactionManager');

router.use(verifyToken);

router.get('/estado', async (req, res) => {
  try {
    const caja = await Caja.findOne({ estado: 'abierta' })
      .populate('usuario_id', 'usuario')
      .sort({ apertura: -1 });
    if (!caja) return res.json(null);

    // Sumar movimientos manuales del turno
    const movs = await MovimientoCaja.aggregate([
      { $match: { caja_id: caja._id } },
      { $group: { _id: '$tipo', total: { $sum: '$monto' } } },
    ]);
    const ingresosManuales = movs.find(m => m._id === 'ingreso')?.total || 0;
    const egresosManuales  = movs.find(m => m._id === 'egreso')?.total  || 0;

    // Sumar movimientos manuales por método de pago (ingresos y egresos)
    const movsMetodo = await MovimientoCaja.aggregate([
      { $match: { caja_id: caja._id } },
      { $group: { _id: { tipo: '$tipo', metodo: '$metodo_pago' }, total: { $sum: '$monto' } } },
    ]);
    const getMov = (tipo, metodo) => movsMetodo.find(m => m._id?.tipo === tipo && m._id?.metodo === metodo)?.total || 0;
    const ingresosManEfectivo      = getMov('ingreso', 'efectivo');
    const ingresosManYape          = getMov('ingreso', 'yape');
    const ingresosManPlin          = getMov('ingreso', 'plin');
    const ingresosManTransferencia = getMov('ingreso', 'transferencia');
    const egresosManEfectivo       = getMov('egreso', 'efectivo');
    const egresosManYape           = getMov('egreso', 'yape');
    const egresosManPlin           = getMov('egreso', 'plin');
    const egresosManTransferencia  = getMov('egreso', 'transferencia');

    // Sumar pagos de membresías por método de pago (yape / plin)
    const pagosPorMetodo = await Pago.aggregate([
      { $match: { caja_id: caja._id, estado: 'pagado', metodo_pago: { $in: ['efectivo', 'yape', 'plin', 'transferencia'] } } },
      { $group: { _id: '$metodo_pago', total: { $sum: '$monto' } } },
    ]);

    // Sumar ventas de productos por método de pago (yape / plin)
    const ventasPorMetodo = await Venta.aggregate([
      { $match: { caja_id: caja._id, anulada: false, metodo_pago: { $in: ['efectivo', 'yape', 'plin', 'transferencia'] } } },
      { $unwind: '$items' },
      { $group: { _id: '$metodo_pago', total: { $sum: '$items.subtotal' } } },
    ]);

    const totalEfectivoPagos = pagosPorMetodo.find(m => m._id === 'efectivo')?.total || 0;
    const totalYapePagos     = pagosPorMetodo.find(m => m._id === 'yape')?.total     || 0;
    const totalPlinPagos     = pagosPorMetodo.find(m => m._id === 'plin')?.total     || 0;
    const totalTransPagos    = pagosPorMetodo.find(m => m._id === 'transferencia')?.total || 0;
    const totalEfectivoVentas = ventasPorMetodo.find(m => m._id === 'efectivo')?.total || 0;
    const totalYapeVentas     = ventasPorMetodo.find(m => m._id === 'yape')?.total    || 0;
    const totalPlinVentas     = ventasPorMetodo.find(m => m._id === 'plin')?.total    || 0;
    const totalTransVentas    = ventasPorMetodo.find(m => m._id === 'transferencia')?.total || 0;

    const totalPagos    = totalEfectivoPagos + totalYapePagos + totalPlinPagos + totalTransPagos;
    const totalVentas   = totalEfectivoVentas + totalYapeVentas + totalPlinVentas + totalTransVentas;
    const total_turno   = totalPagos + totalVentas + ingresosManuales;

    // Total en caja: monto inicial + efectivo físico (ventas en efectivo + pagos en efectivo + ingresos manuales efectivo - egresos manuales efectivo)
    const totalEfectivo = totalEfectivoPagos + totalEfectivoVentas + ingresosManEfectivo - egresosManEfectivo;
    const total_en_caja = parseFloat(caja.monto_inicial || 0) + totalEfectivo;

    // Ingresos totales: todo el dinero disponible (caja + digitales)
    const total_yape          = totalYapePagos     + totalYapeVentas     + ingresosManYape - egresosManYape;
    const total_plin          = totalPlinPagos     + totalPlinVentas     + ingresosManPlin - egresosManPlin;
    const total_transferencia = totalTransPagos + totalTransVentas + ingresosManTransferencia - egresosManTransferencia;
    const ingresos_totales    = total_en_caja + total_yape + total_plin + total_transferencia;

    res.json({
      ...caja.toObject(),
      id: caja._id,
      usuario_nombre: caja.usuario_id?.usuario,
      ingresos_manuales: ingresosManuales,
      egresos_manuales: egresosManuales,
      total_yape,
      total_plin,
      total_transferencia,
      total_en_caja,
      ingresos_totales,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  try {
    const total = await Caja.countDocuments();
    const cajas = await Caja.find()
      .populate('usuario_id', 'usuario')
      .sort({ apertura: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const data = await Promise.all(cajas.map(async (c) => {
      const ingresosMem = await Pago.aggregate([
        { $match: { caja_id: c._id, estado: 'pagado' } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]);
      const ingresosVentas = await Venta.aggregate([
        { $match: { caja_id: c._id, anulada: false } },
        { $unwind: '$items' },
        { $group: { _id: null, total: { $sum: '$items.subtotal' } } },
      ]);
      const movs = await MovimientoCaja.aggregate([
        { $match: { caja_id: c._id } },
        { $group: { _id: '$tipo', total: { $sum: '$monto' } } },
      ]);
      const ingresosManuales = movs.find(m => m._id === 'ingreso')?.total || 0;
      const egresosManuales  = movs.find(m => m._id === 'egreso')?.total  || 0;
      const totalPagos  = ingresosMem[0]?.total || 0;
      const totalVentas = ingresosVentas[0]?.total || 0;
      const total_turno = totalPagos + totalVentas + ingresosManuales;
      return {
        ...c.toObject(),
        id: c._id,
        usuario_nombre: c.usuario_id?.usuario,
        ingresos_membresias: totalPagos,
        ingresos_ventas: totalVentas,
        ingresos_manuales: ingresosManuales,
        egresos_manuales: egresosManuales,
        total_turno,
      };
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/abrir', asyncHandler(async (req, res) => {
  const { monto_inicial, notas } = req.body;
  
  const caja = await CajaService.abrir({
    usuario_id: req.user.id,
    monto_inicial,
    notas
  });
  
  res.status(201).json(caja);
}));

router.put('/cerrar/:id', asyncHandler(async (req, res) => {
  const { monto_final, notas } = req.body;
  
  const caja = await CajaService.cerrar(req.params.id, {
    monto_final,
    notas
  });
  
  res.json(caja);
}));

router.get('/:id/detalle', async (req, res) => {
  try {
    const pagos = await Pago.find({ caja_id: req.params.id, estado: 'pagado' })
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
      .sort({ fecha_pago: -1 });

    const ventas = await Venta.find({ caja_id: req.params.id })
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
      .populate('items.producto_id', 'nombre')
      .sort({ fecha_venta: -1 });

    const movimientos = await MovimientoCaja.find({ caja_id: req.params.id })
      .populate('usuario_id', 'usuario')
      .sort({ fecha: -1 });

    const pagosData = pagos.map(p => ({
      ...p.toObject(),
      id: p._id,
      cliente_nombre: [p.cliente_id?.nombre, p.cliente_id?.apellido_paterno, p.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
      plan_nombre: p.membresia_id?.plan_id?.nombre,
    }));

    // Aplanar ventas por item (igual que el original)
    const ventasData = [];
    for (const v of ventas) {
      for (const item of v.items) {
        ventasData.push({
          id: v._id,
          fecha_venta: v.fecha_venta,
          cliente_id: v.cliente_id?._id,
          anulada: v.anulada,
          anulada_at: v.anulada_at,
          metodo_pago: v.metodo_pago || 'efectivo',
          cliente_nombre: [v.cliente_id?.nombre, v.cliente_id?.apellido_paterno, v.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
          producto_nombre: item.producto_id?.nombre,
          cantidad: item.cantidad,
          precio_unit: item.precio_unit,
          subtotal: item.subtotal,
        });
      }
    }

    const movimientosData = movimientos.map(m => ({
      ...m.toObject(),
      id: m._id,
      usuario_nombre: m.usuario_id?.usuario,
    }));

    res.json({ pagos: pagosData, ventas: ventasData, movimientos: movimientosData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Movimientos manuales (ingresos/egresos) ---

// Registrar un movimiento manual
router.post('/:id/movimientos', asyncHandler(async (req, res) => {
  const { tipo, monto, concepto, metodo_pago, es_rutina } = req.body;
  
  const mov = await CajaService.registrarMovimiento(req.params.id, {
    usuario_id: req.user.id,
    tipo,
    monto,
    concepto,
    metodo_pago,
    es_rutina,
  });
  
  res.status(201).json({ ...mov.toObject(), id: mov._id });
}));

// Listar movimientos de una caja
router.get('/:id/movimientos', async (req, res) => {
  try {
    const movs = await MovimientoCaja.find({ caja_id: req.params.id })
      .populate('usuario_id', 'usuario')
      .sort({ fecha: -1 });
    res.json(movs.map(m => ({ ...m.toObject(), id: m._id, usuario_nombre: m.usuario_id?.usuario })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar un movimiento (solo si la caja sigue abierta)
router.delete('/:cajaId/movimientos/:movId', async (req, res) => {
  try {
    const caja = await Caja.findOne({ _id: req.params.cajaId, estado: 'abierta' });
    if (!caja) return res.status(400).json({ error: 'Solo se pueden eliminar movimientos de una caja abierta' });
    const mov = await MovimientoCaja.findOneAndDelete({ _id: req.params.movId, caja_id: req.params.cajaId });
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
