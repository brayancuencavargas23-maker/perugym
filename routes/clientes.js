const router = require('express').Router();
const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const { verifyToken } = require('../middleware/auth');
const { saveImage, deleteImage } = require('../config/storage');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const { search, activo, page = 1, limit = 20 } = req.query;
  const filter = {};

  if (search) {
    // Escapar caracteres especiales de regex para evitar ReDoS
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { nombre: { $regex: safeSearch, $options: 'i' } },
      { dni: { $regex: safeSearch, $options: 'i' } },
      { email: { $regex: safeSearch, $options: 'i' } },
    ];
  }
  if (activo !== undefined && activo !== '') filter.activo = activo === 'true';

  try {
    const total = await Cliente.countDocuments(filter);
    const clientes = await Cliente.find(filter)
      .sort({ nombre: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Enriquecer con datos de membresía
    const data = await Promise.all(clientes.map(async (c) => {
      const mem = await Membresia.findOne({ cliente_id: c._id })
        .sort({ estado: 1, fecha_fin: -1 })
        .populate('plan_id', 'nombre');

      // Ordenar: activo > pendiente > resto
      const mems = await Membresia.find({ cliente_id: c._id })
        .populate('plan_id', 'nombre')
        .sort({ fecha_fin: -1 });

      const priority = { activo: 0, pendiente: 1, vencido: 2, cancelado: 3 };
      mems.sort((a, b) => (priority[a.estado] ?? 4) - (priority[b.estado] ?? 4));
      const best = mems[0];

      return {
        ...c.toObject(),
        id: c._id,
        membresia_estado: best?.estado || null,
        fecha_fin: best?.fecha_fin || null,
        plan_nombre: best?.plan_id?.nombre || null,
      };
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findById(req.params.id);
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const mems = await Membresia.find({ cliente_id: req.params.id })
      .populate('plan_id', 'nombre precio')
      .sort({ fecha_fin: -1 });

    const priority = { activo: 0, pendiente: 1, vencido: 2, cancelado: 3 };
    mems.sort((a, b) => (priority[a.estado] ?? 4) - (priority[b.estado] ?? 4));

    const membresias = mems.map(m => ({
      ...m.toObject(),
      id: m._id,
      plan_nombre: m.plan_id?.nombre,
      precio: m.plan_id?.precio,
    }));

    res.json({ ...cliente.toObject(), id: cliente._id, membresias });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { nombre, dni, email, telefono, notas } = req.body;
  try {
    let foto_url = null;
    if (req.files?.foto) foto_url = await saveImage(req.files.foto.data, 'clientes', req.files.foto.name);
    const cliente = await Cliente.create({ nombre, dni: dni || null, email: email || null, telefono: telefono || null, foto_url, notas: notas || null });
    res.status(201).json(cliente);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const { nombre, dni, email, telefono, notas, activo } = req.body;
  try {
    const current = await Cliente.findById(req.params.id);
    let foto_url = current?.foto_url;
    if (req.files?.foto) {
      await deleteImage(foto_url);
      foto_url = await saveImage(req.files.foto.data, 'clientes', req.files.foto.name);
    }
    const cliente = await Cliente.findByIdAndUpdate(
      req.params.id,
      { nombre, dni: dni || null, email: email || null, telefono: telefono || null, foto_url, notas: notas || null, activo: activo !== undefined ? activo : true },
      { new: true }
    );
    res.json(cliente);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const c = await Cliente.findById(req.params.id);
    await deleteImage(c?.foto_url);
    await Cliente.findByIdAndDelete(req.params.id);
    res.json({ message: 'Cliente eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
