const router = require('express').Router();
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const { verifyToken, requireRole } = require('../middleware/auth');
const { saveImage, deleteImage } = require('../config/storage');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const { search, categoria, activo, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (search)    filter.nombre = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (categoria) filter.categoria = categoria;
  if (activo !== undefined && activo !== '') filter.activo = activo === 'true';

  try {
    const total = await Producto.countDocuments(filter);
    const data = await Producto.find(filter)
      .sort({ nombre: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/categorias', async (req, res) => {
  try {
    const cats = await Producto.distinct('categoria', { categoria: { $ne: null } });
    res.json(cats.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Productos más vendidos (top 8) — agregación global de ventas no anuladas
router.get('/mas-vendidos', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 9;
    const top = await Venta.aggregate([
      { $match: { anulada: { $ne: true } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.producto_id',
          total_vendido: { $sum: '$items.cantidad' },
        }
      },
      { $sort: { total_vendido: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'productos',
          localField: '_id',
          foreignField: '_id',
          as: 'producto'
        }
      },
      { $unwind: { path: '$producto', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          total_vendido: 1,
          nombre: '$producto.nombre',
          precio_venta: '$producto.precio_venta',
          stock: '$producto.stock',
          foto_url: '$producto.foto_url',
          activo: '$producto.activo',
        }
      },
      { $match: { activo: { $ne: false } } },
    ]);
    res.json(top);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { nombre, categoria, precio_venta, stock, descripcion } = req.body;
  try {
    let foto_url = null;
    if (req.files?.foto) foto_url = await saveImage(req.files.foto.data, 'productos', req.files.foto.name);
    const producto = await Producto.create({ nombre, categoria, precio_venta, stock: stock || 0, descripcion, foto_url });
    res.status(201).json(producto);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { nombre, categoria, precio_venta, stock, descripcion, activo } = req.body;
  try {
    const current = await Producto.findById(req.params.id);
    let foto_url = current?.foto_url;
    if (req.files?.foto) {
      await deleteImage(foto_url);
      foto_url = await saveImage(req.files.foto.data, 'productos', req.files.foto.name);
    }
    const producto = await Producto.findByIdAndUpdate(
      req.params.id,
      { nombre, categoria, precio_venta, stock, descripcion, foto_url, activo },
      { new: true }
    );
    res.json(producto);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const p = await Producto.findById(req.params.id);
    await deleteImage(p?.foto_url);
    await Producto.findByIdAndDelete(req.params.id);
    res.json({ message: 'Producto eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
