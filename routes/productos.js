const router = require('express').Router();
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const { verifyToken, requireRole } = require('../middleware/auth');
const { saveImage, deleteImage } = require('../config/storage');
const mongoose = require('mongoose');
const Movimiento = require('../models/MovimientoInventario');
const Lote = require('../models/Lote');
const Inventario = require('../services/InventarioService');
const TransactionManager = require('../utils/TransactionManager');
const { parseDate } = require('../utils/reportDates');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const { search, categoria, activo, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (search) {
    const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [{ nombre: rx }, { descripcion: rx }, { codigo_barras: rx }];
  }
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

router.get('/:id/movimientos', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Producto inválido.' });
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const filter = { producto_id: req.params.id };
    const [data, total] = await Promise.all([
      Movimiento.find(filter).sort({ fecha: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
      Movimiento.countDocuments(filter)
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / 20) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/movimientos', requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Producto inválido.' });
  try { res.status(201).json(await Inventario.modificar(req.params.id, req.body, req.user)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Lotes (trazabilidad de vencimientos) ──────────────────────────────────────
router.get('/:id/lotes', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Producto inválido.' });
  try {
    const data = await Lote.find({ producto_id: req.params.id }).sort({ fecha_vencimiento: 1 }).lean();
    res.json({ data, total: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/lotes', requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Producto inválido.' });
  const { numero_lote, cantidad, fecha_vencimiento } = req.body;
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) return res.status(400).json({ error: 'La cantidad debe ser un entero mayor a 0.' });
  let fecha;
  try {
    fecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha_vencimiento) ? parseDate(fecha_vencimiento) : new Date(fecha_vencimiento);
    if (!fecha_vencimiento || isNaN(fecha.getTime())) throw new Error('Fecha inválida.');
  } catch { return res.status(400).json({ error: 'Indica una fecha de vencimiento válida.' }); }
  if (numero_lote !== undefined && numero_lote !== null && (typeof numero_lote !== 'string' || numero_lote.length > 40)) {
    return res.status(400).json({ error: 'Número de lote inválido (máximo 40 caracteres).' });
  }
  try {
    const producto = await Producto.findById(req.params.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });
    if (!producto.activo) return res.status(400).json({ error: 'Activa el producto antes de registrar lotes.' });
    const lote = await Lote.create({
      producto_id: producto._id,
      numero_lote: numero_lote ? String(numero_lote).trim() || null : null,
      cantidad,
      fecha_vencimiento: fecha,
      usuario_id: String(req.user.id),
      responsable: req.user.name || req.user.email || String(req.user.id),
    });
    res.status(201).json(lote);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/lotes/:loteId', requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.loteId)) {
    return res.status(400).json({ error: 'Identificador inválido.' });
  }
  try {
    const lote = await Lote.findOneAndDelete({ _id: req.params.loteId, producto_id: req.params.id });
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado.' });
    res.json({ message: 'Lote eliminado. El stock del producto no cambia.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function validarProducto(body, crear) {
  if ((crear || body.nombre !== undefined) && (typeof body.nombre !== 'string' || !body.nombre.trim())) return 'Indica el nombre.';
  if ((crear || body.precio_venta !== undefined) && (body.precio_venta === '' || !Number.isFinite(Number(body.precio_venta)) || Number(body.precio_venta) < 0)) return 'Precio inválido.';
  for (const key of ['stock', 'stock_minimo']) {
    if (body[key] !== undefined && (body[key] === '' || !Number.isSafeInteger(Number(body[key])) || Number(body[key]) < 0)) return 'Stock y mínimo deben ser enteros no negativos.';
  }
  if (body.codigo_barras !== undefined && body.codigo_barras !== null && body.codigo_barras !== '') {
    if (typeof body.codigo_barras !== 'string' || !/^[A-Za-z0-9\-. ]{1,30}$/.test(body.codigo_barras.trim())) {
      return 'Código de barras inválido: usa hasta 30 caracteres (letras, números, guiones o puntos).';
    }
  }
}

async function codigoDuplicado(codigo, excluirId) {
  if (!codigo) return false;
  const filter = { codigo_barras: codigo };
  if (excluirId) filter._id = { $ne: excluirId };
  return !!(await Producto.findOne(filter).select('_id').lean());
}

router.post('/', requireRole('admin'), async (req, res) => {
  const { nombre, categoria, precio_venta, stock, stock_minimo, descripcion, codigo_barras } = req.body;
  const invalid = validarProducto(req.body, true);
  if (invalid) return res.status(400).json({ error: invalid });
  const codigo = codigo_barras ? String(codigo_barras).trim() : null;
  try {
    if (await codigoDuplicado(codigo)) return res.status(400).json({ error: 'Ese código de barras ya está registrado en otro producto.' });
    let foto_url = null;
    if (req.files?.foto) foto_url = await saveImage(req.files.foto.data, 'productos', req.files.foto.name);
    const producto = await TransactionManager.execute(async session => {
      const [p] = await Producto.create([{ nombre, categoria, precio_venta, stock: stock || 0, stock_minimo, descripcion, codigo_barras: codigo, foto_url }], { session });
      try { await Inventario.registrar(p, 0, { tipo: 'inicial', motivo: 'Stock inicial al crear el producto', user: req.user }, session); }
      catch (err) { if (!session) await Producto.deleteOne({ _id: p._id }); throw err; }
      return p;
    });
    res.status(201).json(producto);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ese código de barras ya está registrado en otro producto.' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { nombre, categoria, precio_venta, stock_minimo, descripcion, activo, codigo_barras } = req.body;
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Producto inválido.' });
  if (req.body.stock !== undefined) return res.status(400).json({ error: 'Usa Registrar entrada o Ajustar inventario para cambiar el stock.' });
  const invalid = validarProducto(req.body, false);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const current = await Producto.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Producto no encontrado.' });
    const codigo = codigo_barras === undefined ? current.codigo_barras || null
      : (codigo_barras ? String(codigo_barras).trim() : null);
    if (codigo !== (current.codigo_barras || null) && await codigoDuplicado(codigo, req.params.id)) {
      return res.status(400).json({ error: 'Ese código de barras ya está registrado en otro producto.' });
    }
    let foto_url = current?.foto_url;
    if (req.files?.foto) {
      await deleteImage(foto_url);
      foto_url = await saveImage(req.files.foto.data, 'productos', req.files.foto.name);
    }
    const producto = await Producto.findByIdAndUpdate(
      req.params.id,
      { nombre, categoria, precio_venta, stock_minimo, descripcion, foto_url, activo, codigo_barras: codigo },
      { new: true, runValidators: true }
    );
    res.json(producto);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ese código de barras ya está registrado en otro producto.' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Producto inválido.' });
  try {
    const p = await Producto.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
    if (!p) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json({ message: 'Producto desactivado. Historial conservado.', producto: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
