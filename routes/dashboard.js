const router = require('express').Router();
const Cliente = require('../models/Cliente');
const Pago = require('../models/Pago');
const Asistencia = require('../models/Asistencia');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const Producto = require('../models/Producto');
const Lote = require('../models/Lote');
const Venta = require('../models/Venta');
const Caja = require('../models/Caja');
const MovimientoCaja = require('../models/MovimientoCaja');
const { verifyToken } = require('../middleware/auth');
const { DAY, limaDate, parseDate, period: reportPeriod } = require('../utils/reportDates');
const NotificacionesService = require('../services/NotificacionesService');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    await require('../services/MembresiaService').autoVencer();
    const { periodo = 'mes' } = req.query;
    const now = new Date();
    const today = parseDate(limaDate(now));
    const tomorrow = new Date(+today + DAY);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);

    let startOfPeriod, startOfPrevPeriod;
    switch (periodo) {
      case 'hoy':
        startOfPeriod = today;
        startOfPrevPeriod = new Date(today); startOfPrevPeriod.setDate(startOfPrevPeriod.getDate() - 1);
        break;
      case 'semana':
        startOfPeriod = new Date(+today - 6 * DAY);
        break;
      case 'mes':
      default:
        startOfPeriod = parseDate(`${limaDate(now).slice(0, 7)}-01`);
        break;
    }
    startOfPrevPeriod = reportPeriod({ from: limaDate(startOfPeriod), to: limaDate(today) }, now).previousStart;

    const [
      clientesResumen,
      ingresosActuales,
      ingresosAnteriores,
      asistenciaActual,
      asistenciaAnterior,
      pagosPendientes,
      enElGym,
      membresiasVencenPronto,
      membresiasVencenManana,
    ] = await Promise.all([
      require('../services/DashboardClientesService').resumen(now),
      Pago.aggregate([
        { $match: { estado: 'pagado', fecha_pago: { $gte: startOfPeriod, $lt: tomorrow } } },
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
      if (anterior === 0) return null;
      return Math.round(((actual - anterior) / anterior) * 100);
    };

    const ingresoActual = ingresosActuales[0]?.total || 0;
    const ingresoAnterior = ingresosAnteriores[0]?.total || 0;

    // Total del turno actual (caja abierta): cobros de membresías (incluye
    // abonos) + ventas de productos + ingresos manuales (rutinas y otros),
    // sin importar el método de pago. Al cerrar la caja no hay turno y el
    // contador vuelve a 0.
    const cajaAbierta = await Caja.findOne({ estado: 'abierta' }).populate('usuario_id', 'usuario').sort({ apertura: -1 });
    let ventasTurno = { total: 0, cajero: null, abierta: false };
    if (cajaAbierta) {
      const [pagosTurno, ventasProductos, ingresosManuales] = await Promise.all([
        Pago.aggregate([
          { $match: { caja_id: cajaAbierta._id, estado: 'pagado' } },
          { $group: { _id: null, total: { $sum: '$monto' } } },
        ]),
        Venta.aggregate([
          { $match: { caja_id: cajaAbierta._id, anulada: false } },
          { $unwind: '$items' },
          { $group: { _id: null, total: { $sum: '$items.subtotal' } } },
        ]),
        MovimientoCaja.aggregate([
          { $match: { caja_id: cajaAbierta._id, tipo: 'ingreso' } },
          { $group: { _id: null, total: { $sum: '$monto' } } },
        ]),
      ]);
      ventasTurno = {
        total: (pagosTurno[0]?.total || 0) + (ventasProductos[0]?.total || 0) + (ingresosManuales[0]?.total || 0),
        cajero: cajaAbierta.usuario_id?.usuario || null,
        abierta: true,
      };
    }

    res.json({
      stats: {
        ...clientesResumen,
        ingresosDelMes: ingresoActual,
        ventasTurno,
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
    res.set('Cache-Control', 'no-store').json(await NotificacionesService.listar(req.user.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/notifications/read', async (req, res) => {
  const { claves } = req.body;
  if (!Array.isArray(claves) || claves.length > 500 || claves.some(k => typeof k !== 'string' || !/^(?:[a-f0-9]{64}|solicitud:[a-f0-9]{24})$/.test(k))) {
    return res.status(400).json({ error: 'Envía hasta 500 claves de notificaciones válidas.' });
  }
  try {
    res.set('Cache-Control', 'no-store').json(await NotificacionesService.marcarLeidas(req.user.id, claves));
  } catch (err) { res.status(500).json({ error: 'No se pudieron marcar las notificaciones como leídas.' }); }
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
        .sort({ updatedAt: -1 }).limit(5),
      Venta.find({ anulada: { $ne: true } }).populate('cliente_id', 'nombre apellido_paterno')
        .sort({ fecha_venta: -1 }).limit(5),
    ]);

    const events = [];
    ultimosPagos.forEach(p => {
      const name = [p.cliente_id?.nombre, p.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      const pago = require('../services/MembresiaPagosService').presentarPago(p);
      events.push({ tipo: 'pago', titulo: `Pago de ${name}`, detalle: `S/. ${p.monto} — ${pago.plan_nombre || ''}`, fecha: p.fecha_pago, icono: 'pago', link: '/pagos.html' });
    });
    ultimasAsistencias.forEach(a => {
      const name = [a.cliente_id?.nombre, a.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      events.push({ tipo: 'asistencia', titulo: `${name} — check-in`, detalle: a.salida ? `Salida: ${new Date(a.salida).toLocaleTimeString('es-PE')}` : 'En el gym', fecha: a.fecha, icono: 'asistencia', link: '/asistencia.html' });
    });
    ultimasMembresias.forEach(m => {
      const name = [m.cliente_id?.nombre, m.cliente_id?.apellido_paterno].filter(Boolean).join(' ');
      const periodo = m.periodos?.at(-1);
      events.push({ tipo: 'membresia', titulo: `${periodo && !periodo.inicial ? 'Renovación' : 'Membresía'} — ${name}`,
        detalle: `${periodo?.plan_nombre || m.plan_nombre || m.plan_id?.nombre || ''} — S/. ${periodo?.monto_total ?? m.monto_total ?? m.plan_id?.precio ?? 0}`,
        fecha: periodo?.registrado_en || m.created_at || m.fecha_inicio, icono: 'membresia', link: '/membresias.html' });
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
    const today = parseDate(limaDate(new Date()));
    const in30 = new Date(+today + 31 * DAY);
    const lotes = await Lote.find({ fecha_vencimiento: { $lt: in30 } })
      .populate('producto_id', 'nombre')
      .select('numero_lote cantidad fecha_vencimiento producto_id')
      .sort({ fecha_vencimiento: 1 }).limit(30).lean();
    res.json({
      products: products.map(p => ({ _id: p._id, nombre: p.nombre, stock: p.stock, precio_venta: p.precio_venta, categoria: p.categoria })),
      total: products.length,
      lotes: lotes.map(l => {
        const dias = Math.round((parseDate(limaDate(l.fecha_vencimiento)) - today) / DAY);
        return { _id: l._id, producto: l.producto_id?.nombre || 'Producto',
          numero_lote: l.numero_lote, cantidad: l.cantidad,
          fecha_vencimiento: limaDate(l.fecha_vencimiento), dias, vencido: dias < 0 };
      }),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
