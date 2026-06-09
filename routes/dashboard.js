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
    const { periodo = 'mes' } = req.query;
    const now = new Date();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 1);

    let startOfPeriod, startOfPrevPeriod;
    switch (periodo) {
      case 'hoy':
        startOfPeriod = today;
        startOfPrevPeriod = new Date(today); startOfPrevPeriod.setDate(startOfPrevPeriod.getDate() - 1);
        break;
      case 'semana':
        startOfPeriod = new Date(today); startOfPeriod.setDate(startOfPeriod.getDate() - 7);
        startOfPrevPeriod = new Date(today); startOfPrevPeriod.setDate(startOfPrevPeriod.getDate() - 14);
        break;
      case 'mes':
      default:
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfPrevPeriod = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
    }

    const [
      clientesActivos,
      ingresosActuales,
      ingresosAnteriores,
      asistenciaActual,
      asistenciaAnterior,
      pagosPendientes,
      enElGym,
      membresiasVencenPronto,
      pagosRecientes,
      clientesPorPlan,
      membresiasVencenManana,
    ] = await Promise.all([
      Cliente.countDocuments({ activo: true }),

      Pago.aggregate([
        { $match: { estado: 'pagado', fecha_pago: { $gte: startOfPeriod } } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]),

      Pago.aggregate([
        { $match: { estado: 'pagado', fecha_pago: { $gte: startOfPrevPeriod, $lt: startOfPeriod } } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]),

      Asistencia.countDocuments({ fecha: { $gte: startOfPeriod, $lt: tomorrow } }),

      Asistencia.countDocuments({ fecha: { $gte: startOfPrevPeriod, $lt: startOfPeriod } }),

      Pago.countDocuments({ estado: 'pendiente' }),

      Asistencia.countDocuments({ fecha: { $gte: today, $lt: tomorrow }, salida: null }),

      Membresia.find({ estado: 'activo', fecha_fin: { $gte: today, $lte: in7 } })
        .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
        .populate('plan_id', 'nombre')
        .sort({ fecha_fin: 1 }),

      Pago.find()
        .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
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

      Membresia.find({ estado: 'activo', fecha_fin: { $gte: today, $lte: in7 } })
        .populate('cliente_id', 'nombre apellido_paterno apellido_materno')
        .sort({ fecha_fin: 1 }),
    ]);

    const calcTrend = (actual, anterior) => {
      if (anterior === 0) return actual > 0 ? 100 : 0;
      return Math.round(((actual - anterior) / anterior) * 100);
    };

    const ingresoActual = ingresosActuales[0]?.total || 0;
    const ingresoAnterior = ingresosAnteriores[0]?.total || 0;

    res.json({
      stats: {
        clientesActivos,
        ingresosDelMes: ingresoActual,
        asistenciaHoy: asistenciaActual,
        pagosPendientes,
        enElGym,
        tendencias: {
          ingresos: calcTrend(ingresoActual, ingresoAnterior),
          asistencia: calcTrend(asistenciaActual, asistenciaAnterior),
        },
      },
      membresiasVencenPronto: membresiasVencenPronto.map(m => ({
        id: m._id,
        nombre: [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno, m.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
        fecha_fin: m.fecha_fin,
        plan_nombre: m.plan_id?.nombre,
      })),
      pagosRecientes: pagosRecientes.map(p => ({
        ...p.toObject(),
        id: p._id,
        cliente_nombre: [p.cliente_id?.nombre, p.cliente_id?.apellido_paterno, p.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
        plan_nombre: p.membresia_id?.plan_id?.nombre,
      })),
      clientesPorPlan,
      alertas: {
        vencenManana: membresiasVencenManana.filter(m => {
          const diff = Math.ceil((new Date(m.fecha_fin) - today) / (1000 * 60 * 60 * 24));
          return diff <= 1;
        }).map(m => ({
          id: m._id,
          nombre: [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno, m.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
          fecha_fin: m.fecha_fin,
          plan_nombre: m.plan_id?.nombre,
        })),
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
