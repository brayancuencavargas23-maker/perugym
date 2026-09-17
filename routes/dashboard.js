const router = require('express').Router();
const Cliente = require('../models/Cliente');
const Pago = require('../models/Pago');
const Asistencia = require('../models/Asistencia');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const MovimientoCaja = require('../models/MovimientoCaja');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { periodo = 'mes' } = req.query;
    const now = new Date();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);

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

router.get('/charts', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(today); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const asistencia = await Asistencia.aggregate([
      { $match: { fecha: { $gte: startOfWeek } } },
      { $group: { _id: { $dayOfWeek: '$fecha' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const asistenciaData = Array(7).fill(0);
    asistencia.forEach(a => { asistenciaData[a._id - 1] = a.count; });
    res.json({
      asistencia: { labels: dayLabels, data: asistenciaData },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/notifications', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const in3 = new Date(today); in3.setDate(in3.getDate() + 3);

    const [vencenHoy, vencen3d, pagosPendientes, stockBajo] = await Promise.all([
      Membresia.find({ estado: 'activo', fecha_fin: { $gte: today, $lt: tomorrow } })
        .populate('cliente_id', 'nombre apellido_paterno')
        .populate('plan_id', 'nombre'),
      Membresia.find({ estado: 'activo', fecha_fin: { $gte: tomorrow, $lte: in3 } })
        .populate('cliente_id', 'nombre apellido_paterno')
        .populate('plan_id', 'nombre'),
      Pago.countDocuments({ estado: 'pendiente' }),
      Producto.countDocuments({ activo: true, stock: { $lte: 5 } }),
    ]);

    const notifications = [];
    vencenHoy.forEach(m => {
      const name = [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      notifications.push({ tipo: 'vencimiento_hoy', titulo: `${name} — vence hoy`, detalle: m.plan_id?.nombre || '', prioridad: 'alta' });
    });
    vencen3d.forEach(m => {
      const name = [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      const days = Math.ceil((new Date(m.fecha_fin) - today) / (1000 * 60 * 60 * 24));
      notifications.push({ tipo: 'vencimiento_proximo', titulo: `${name} — vence en ${days}d`, detalle: m.plan_id?.nombre || '', prioridad: 'media' });
    });
    if (pagosPendientes > 0) notifications.push({ tipo: 'pagos_pendientes', titulo: `${pagosPendientes} pagos pendientes`, detalle: 'Requieren atención', prioridad: 'media' });
    if (stockBajo > 0) notifications.push({ tipo: 'stock_bajo', titulo: `${stockBajo} productos con stock bajo`, detalle: 'Revisar inventario', prioridad: 'baja' });

    notifications.sort((a, b) => {
      const order = { alta: 0, media: 1, baja: 2 };
      return (order[a.prioridad] || 2) - (order[b.prioridad] || 2);
    });

    res.json({ total: notifications.length, items: notifications });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/activity', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

    const [ultimosPagos, ultimasAsistencias, ultimasMembresias, ultimasVentas] = await Promise.all([
      Pago.find().populate('cliente_id', 'nombre apellido_paterno')
        .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
        .sort({ fecha_pago: -1 }).limit(5),
      Asistencia.find().populate('cliente_id', 'nombre apellido_paterno')
        .sort({ fecha: -1 }).limit(5),
      Membresia.find().populate('cliente_id', 'nombre apellido_paterno')
        .populate('plan_id', 'nombre precio')
        .sort({ createdAt: -1 }).limit(5),
      Venta.find({ anulada: { $ne: true } }).populate('cliente_id', 'nombre apellido_paterno')
        .sort({ fecha_venta: -1 }).limit(5),
    ]);

    const events = [];
    ultimosPagos.forEach(p => {
      const name = [p.cliente_id?.nombre, p.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      events.push({ tipo: 'pago', titulo: `Pago de ${name}`, detalle: `S/. ${p.monto} — ${p.membresia_id?.plan_id?.nombre || ''}`, fecha: p.fecha_pago, icono: 'pago', link: '/pagos.html' });
    });
    ultimasAsistencias.forEach(a => {
      const name = [a.cliente_id?.nombre, a.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      events.push({ tipo: 'asistencia', titulo: `${name} — check-in`, detalle: a.salida ? `Salida: ${new Date(a.salida).toLocaleTimeString('es-PE')}` : 'En el gym', fecha: a.fecha, icono: 'asistencia', link: '/asistencia.html' });
    });
    ultimasMembresias.forEach(m => {
      const name = [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      events.push({ tipo: 'membresia', titulo: `Membresía — ${name}`, detalle: `${m.plan_id?.nombre || ''} — S/. ${m.monto_total || m.plan_id?.precio || 0}`, fecha: m.createdAt || m.fecha_inicio, icono: 'membresia', link: '/membresias.html' });
    });
    ultimasVentas.forEach(v => {
      const name = v.cliente_id ? [v.cliente_id?.nombre, v.cliente_id?.apellido_paterno].filter(Boolean).join(' ') : 'Cliente general';
      const totalItems = v.items ? v.items.reduce((sum, i) => sum + i.cantidad, 0) : 0;
      const totalVenta = v.items ? v.items.reduce((sum, i) => sum + i.subtotal, 0) : 0;
      events.push({ tipo: 'venta', titulo: `Venta — ${name}`, detalle: `${totalItems} producto${totalItems !== 1 ? 's' : ''} — S/. ${totalVenta.toFixed(2)}`, fecha: v.fecha_venta, icono: 'venta', link: '/productos.html' });
    });

    events.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json(events.slice(0, 12));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ingresos-hoy', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

    const [ingresosHoy, ingresosAyer] = await Promise.all([
      MovimientoCaja.aggregate([
        { $match: { tipo: 'ingreso', fecha: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: '$metodo_pago', total: { $sum: '$monto' } } },
      ]),
      MovimientoCaja.aggregate([
        { $match: { tipo: 'ingreso', fecha: { $gte: yesterday, $lt: today } } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]),
    ]);

    const totalHoy = ingresosHoy.reduce((sum, m) => sum + m.total, 0);
    const totalAyer = ingresosAyer[0]?.total || 0;
    const tendencia = totalAyer > 0 ? Math.round(((totalHoy - totalAyer) / totalAyer) * 100) : (totalHoy > 0 ? 100 : 0);

    const metodoLabels = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia' };
    const desglose = ingresosHoy.map(m => ({
      metodo: m._id,
      label: metodoLabels[m._id] || m._id,
      hoy: m.total,
    })).sort((a, b) => b.hoy - a.hoy);

    res.json({ total_hoy: totalHoy, tendencia, desglose });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/top-clients', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(today); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const topClients = await Asistencia.aggregate([
      { $match: { fecha: { $gte: startOfWeek } } },
      { $group: { _id: '$cliente_id', visitas: { $sum: 1 } } },
      { $sort: { visitas: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'clientes', localField: '_id', foreignField: '_id', as: 'cliente' } },
      { $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, visitas: 1, nombre: { $concat: ['$cliente.nombre', ' ', { $ifNull: ['$cliente.apellido_paterno', ''] }] } } },
    ]);

    res.json({ topClients });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/top-products', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(today); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const topProducts = await Venta.aggregate([
      { $match: { anulada: { $ne: true }, fecha_venta: { $gte: startOfWeek } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.producto_id', total_vendido: { $sum: '$items.cantidad' }, total_ingreso: { $sum: '$items.subtotal' } } },
      { $sort: { total_vendido: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'productos', localField: '_id', foreignField: '_id', as: 'producto' } },
      { $unwind: { path: '$producto', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, total_vendido: 1, total_ingreso: 1, nombre: '$producto.nombre', stock: '$producto.stock' } },
    ]);

    res.json({ topProducts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/dashboard/low-stock ────────────────────────────────────────────
// Todos los productos activos con stock <= umbral (por defecto 10).
router.get('/low-stock', async (req, res) => {
  try {
    const umbral = parseInt(req.query.umbral) || 10;
    const products = await Producto.find({ activo: true, stock: { $lte: umbral } })
      .select('nombre stock precio_venta categoria')
      .sort({ stock: 1 });
    res.json({ products: products.map(p => ({ _id: p._id, nombre: p.nombre, stock: p.stock, precio_venta: p.precio_venta, categoria: p.categoria })), total: products.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
