const router = require('express').Router();
const Caja = require('../models/Caja');
const Pago = require('../models/Pago');
const Venta = require('../models/Venta');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

router.get('/estado', async (req, res) => {
  try {
    const caja = await Caja.findOne({ estado: 'abierta' })
      .populate('usuario_id', 'usuario')
      .sort({ apertura: -1 });
    if (!caja) return res.json(null);
    res.json({ ...caja.toObject(), id: caja._id, usuario_nombre: caja.usuario_id?.usuario });
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
      return {
        ...c.toObject(),
        id: c._id,
        usuario_nombre: c.usuario_id?.usuario,
        ingresos_membresias: ingresosMem[0]?.total || 0,
        ingresos_ventas: ingresosVentas[0]?.total || 0,
      };
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/abrir', async (req, res) => {
  const { monto_inicial, notas } = req.body;
  try {
    const abierta = await Caja.findOne({ estado: 'abierta' });
    if (abierta) return res.status(400).json({ error: 'Ya hay una caja abierta' });
    const caja = await Caja.create({ usuario_id: req.user.id, monto_inicial: monto_inicial || 0, notas: notas || null });
    res.status(201).json(caja);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/cerrar/:id', async (req, res) => {
  const { monto_final, notas } = req.body;
  try {
    const cajaId = req.params.id;

    const ingresosMem = await Pago.aggregate([
      { $match: { caja_id: require('mongoose').Types.ObjectId.createFromHexString(cajaId), estado: 'pagado' } },
      { $group: { _id: null, total: { $sum: '$monto' } } },
    ]);
    const ingresosVentas = await Venta.aggregate([
      { $match: { caja_id: require('mongoose').Types.ObjectId.createFromHexString(cajaId), anulada: false } },
      { $unwind: '$items' },
      { $group: { _id: null, total: { $sum: '$items.subtotal' } } },
    ]);

    const total_ingresos = (ingresosMem[0]?.total || 0) + (ingresosVentas[0]?.total || 0);

    const caja = await Caja.findOneAndUpdate(
      { _id: cajaId, estado: 'abierta' },
      { estado: 'cerrada', cierre: new Date(), monto_final: monto_final || 0, total_ingresos, ...(notas ? { notas } : {}) },
      { new: true }
    );
    if (!caja) return res.status(404).json({ error: 'Caja no encontrada o ya cerrada' });
    res.json(caja);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/detalle', async (req, res) => {
  try {
    const pagos = await Pago.find({ caja_id: req.params.id })
      .populate('cliente_id', 'nombre')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
      .sort({ fecha_pago: -1 });

    const ventas = await Venta.find({ caja_id: req.params.id })
      .populate('cliente_id', 'nombre')
      .populate('items.producto_id', 'nombre')
      .sort({ fecha_venta: -1 });

    const pagosData = pagos.map(p => ({
      ...p.toObject(),
      id: p._id,
      cliente_nombre: p.cliente_id?.nombre,
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
          cliente_nombre: v.cliente_id?.nombre,
          producto_nombre: item.producto_id?.nombre,
          cantidad: item.cantidad,
          precio_unit: item.precio_unit,
          subtotal: item.subtotal,
        });
      }
    }

    res.json({ pagos: pagosData, ventas: ventasData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
