const router = require('express').Router();
const mongoose = require('mongoose');
const Compra = require('../models/Compra');
const Proveedor = require('../models/Proveedor');
const ComprasService = require('../services/ComprasService');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { dateFilter, limaDate, parseDate } = require('../utils/reportDates');

router.use(verifyToken);
router.use(requirePermission('compras'));

router.get('/', async (req, res) => {
  const { proveedor_id, desde, hasta, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (proveedor_id) {
    if (!mongoose.isValidObjectId(proveedor_id)) return res.status(400).json({ error: 'Proveedor inválido.' });
    filter.proveedor_id = proveedor_id;
  }
  if (desde || hasta) {
    try { filter.fecha = dateFilter(desde, hasta); }
    catch (err) { return res.status(400).json({ error: err.message }); }
  }

  try {
    const total = await Compra.countDocuments(filter);
    const data = await Compra.find(filter)
      .populate('proveedor_id', 'nombre activo')
      .sort({ fecha: -1, _id: -1 })
      .skip((Math.max(1, parseInt(page)) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// KPIs de la sección: valorización de inventario + compras del mes + proveedores
router.get('/resumen', async (req, res) => {
  try {
    const desde = parseDate(limaDate().slice(0, 7) + '-01');
    const hasta = new Date(desde);
    hasta.setUTCMonth(hasta.getUTCMonth() + 1);
    const [inv, comprasMes, comprasTotal, proveedores] = await Promise.all([
      ComprasService.valorizacion(),
      Compra.aggregate([
        { $match: { anulada: false, fecha: { $gte: desde, $lt: hasta } } },
        { $group: { _id: null, total: { $sum: '$costo_total' }, cantidad: { $sum: 1 } } },
      ]),
      Compra.countDocuments({ anulada: false }),
      Proveedor.countDocuments({ activo: true }),
    ]);
    res.json({
      valorizacion: inv.valorizacion,
      unidades: inv.unidades,
      compras_mes: comprasMes.length ? Math.round(comprasMes[0].total * 100) / 100 : 0,
      compras_mes_cantidad: comprasMes.length ? comprasMes[0].cantidad : 0,
      compras_total: comprasTotal,
      proveedores_activos: proveedores,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const compra = await ComprasService.registrar(req.body, req.user);
    res.status(201).json(compra);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Compra inválida.' });
  try {
    const compra = await Compra.findById(req.params.id).populate('proveedor_id', 'nombre telefono email activo');
    if (!compra) return res.status(404).json({ error: 'Compra no encontrada.' });
    res.json(compra);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
