const router = require('express').Router();
const mongoose = require('mongoose');
const Proveedor = require('../models/Proveedor');
const { verifyToken, requirePermission } = require('../middleware/auth');

router.use(verifyToken);

function validar(body, crear) {
  if ((crear || body.nombre !== undefined) && (typeof body.nombre !== 'string' || !body.nombre.trim())) return 'Indica el nombre del proveedor.';
  if (body.nombre !== undefined && String(body.nombre).trim().length > 120) return 'El nombre no puede superar 120 caracteres.';
  for (const [key, max] of [['contacto', 120], ['telefono', 30], ['email', 120], ['direccion', 200], ['notas', 500]]) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '' && typeof body[key] !== 'string') return `Campo ${key} inválido.`;
    if (typeof body[key] === 'string' && body[key].length > max) return `El campo ${key} supera ${max} caracteres.`;
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return 'Correo electrónico inválido.';
}

router.get('/', async (req, res) => {
  const { search, activo, page = 1, limit = 100 } = req.query;
  const filter = {};
  if (search) {
    const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [{ nombre: rx }, { contacto: rx }, { telefono: rx }];
  }
  if (activo !== undefined && activo !== '') filter.activo = activo === 'true';

  try {
    const total = await Proveedor.countDocuments(filter);
    const data = await Proveedor.find(filter)
      .sort({ nombre: 1 })
      .skip((Math.max(1, parseInt(page)) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requirePermission('compras'), async (req, res) => {
  const invalid = validar(req.body, true);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const { nombre, contacto, telefono, email, direccion, notas } = req.body;
    const proveedor = await Proveedor.create({
      nombre: nombre.trim(),
      contacto: contacto || null,
      telefono: telefono || null,
      email: email || null,
      direccion: direccion || null,
      notas: notas || null,
    });
    res.status(201).json(proveedor);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requirePermission('compras'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Proveedor inválido.' });
  const invalid = validar(req.body, false);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const update = {};
    for (const key of ['nombre', 'contacto', 'telefono', 'email', 'direccion', 'notas', 'activo']) {
      if (req.body[key] !== undefined) update[key] = typeof req.body[key] === 'string' ? req.body[key].trim() || (key === 'nombre' ? req.body[key] : null) : req.body[key];
    }
    if (update.nombre !== undefined && !update.nombre) return res.status(400).json({ error: 'Indica el nombre del proveedor.' });
    const proveedor = await Proveedor.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado.' });
    res.json(proveedor);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requirePermission('compras'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Proveedor inválido.' });
  try {
    const proveedor = await Proveedor.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
    if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado.' });
    res.json({ message: 'Proveedor desactivado. Su historial de compras se conserva.', proveedor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
