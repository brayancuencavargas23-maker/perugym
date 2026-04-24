const router = require('express').Router();
const Cliente = require('../models/Cliente');
const Pago = require('../models/Pago');
const Asistencia = require('../models/Asistencia');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);

    const [
      clientesActivos,
      ingresosDelMes,
      asistenciaHoy,
      pagosPendientes,
      enElGym,
      membresiasVencenPronto,
      pagosRecientes,
      clientesPorPlan,
    ] = await Promise.all([
      Cliente.countDocuments({ activo: true }),

      Pago.aggregate([
        { $match: { estado: 'pagado', fecha_pago: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]),

      Asistencia.countDocuments({ fecha: { $gte: today, $lt: tomorrow } }),

      Pago.countDocuments({ estado: 'pendiente' }),

      Asistencia.countDocuments({ fecha: { $gte: today, $lt: tomorrow }, salida: null }),

      Membresia.find({ estado: 'activo', fecha_fin: { $gte: today, $lte: in7 } })
        .populate('cliente_id', 'nombre')
        .populate('plan_id', 'nombre')
        .sort({ fecha_fin: 1 }),

      Pago.find()
        .populate('cliente_id', 'nombre')
        .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
        .sort({ fecha_pago: -1 })
        .limit(5),

      Plan.aggregate([
        {
          $lookup: {
            from: 'membresias',
            let: { planId: '$_id' },
            pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$plan_id', '$$planId'] }, { $eq: ['$estado', 'activo'] }] } } }],
            as: 'membresias',
          },
        },
        { $project: { nombre: 1, count: { $size: '$membresias' } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      stats: {
        clientesActivos,
        ingresosDelMes: ingresosDelMes[0]?.total || 0,
        asistenciaHoy,
        pagosPendientes,
        enElGym,
      },
      membresiasVencenPronto: membresiasVencenPronto.map(m => ({
        id: m._id,
        nombre: m.cliente_id?.nombre,
        fecha_fin: m.fecha_fin,
        plan_nombre: m.plan_id?.nombre,
      })),
      pagosRecientes: pagosRecientes.map(p => ({
        ...p.toObject(),
        id: p._id,
        cliente_nombre: p.cliente_id?.nombre,
        plan_nombre: p.membresia_id?.plan_id?.nombre,
      })),
      clientesPorPlan,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
