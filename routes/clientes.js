const router = require('express').Router();
const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const { verifyToken } = require('../middleware/auth');
const { saveImage, deleteImage } = require('../config/storage');
const { validators, handleValidationErrors } = require('../middleware/validation');
const { param } = require('express-validator');
const logger = require('../utils/logger');

router.use(verifyToken);

// ── Consulta DNI via API RENIEC ───────────────────────────────────────────────
router.get('/reniec/:dni', [
  param('dni')
    .trim()
    .matches(/^\d{8}$/)
    .withMessage('El DNI debe tener exactamente 8 dígitos.')
], handleValidationErrors, async (req, res) => {
  const { dni } = req.params;

  const apiUrl = process.env.RENIEC_API_URL;
  const token  = process.env.RENIEC_API_TOKEN;

  if (!apiUrl || !token) {
    return res.status(503).json({ error: 'Servicio RENIEC no configurado en el servidor' });
  }

  try {
    const url = `${apiUrl}?numero=${encodeURIComponent(dni)}`;
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 404) {
        return res.status(404).json({ error: 'DNI no encontrado en RENIEC' });
      }
      return res.status(response.status).json({ error: errBody.message || 'Error al consultar RENIEC' });
    }

    const data = await response.json();
    // Devolver solo los campos necesarios
    res.json({
      first_name:       data.first_name       || '',
      first_last_name:  data.first_last_name  || '',
      second_last_name: data.second_last_name || '',
      full_name:        data.full_name        || '',
      document_number:  data.document_number  || dni,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error('RENIEC timeout', { dni, service: 'RENIEC' });
      return res.status(504).json({ error: 'El servicio RENIEC no respondió a tiempo. Intenta de nuevo.' });
    }
    logger.error('RENIEC error', { dni, error: err.message, service: 'RENIEC' });
    res.status(500).json({ error: 'No se pudo conectar con el servicio RENIEC' });
  }
});

router.get('/', async (req, res) => {
  const { search, activo, page = 1, limit = 20 } = req.query;
  const filter = {};

  if (search) {
    // Escape regex special characters to prevent ReDoS
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { nombre: { $regex: safeSearch, $options: 'i' } },
      { apellido_paterno: { $regex: safeSearch, $options: 'i' } },
      { apellido_materno: { $regex: safeSearch, $options: 'i' } },
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
        id: String(c._id),
        membresia_estado: best?.estado || null,
        fecha_fin: best?.fecha_fin || null,
        plan_nombre: best?.plan_id?.nombre || null,
      };
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', [
  validators.mongoId('id', 'param')
], handleValidationErrors, async (req, res) => {
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

router.post('/', [
  validators.telefono(false),
  validators.dni(),
  validators.email()
], handleValidationErrors, async (req, res) => {
  const { nombre, apellido_paterno, apellido_materno, dni, email, telefono, notas } = req.body;
  try {
    let foto_url = null;
    if (req.files?.foto) foto_url = await saveImage(req.files.foto.data, 'clientes', req.files.foto.name);
    const cliente = await Cliente.create({
      nombre,
      apellido_paterno: apellido_paterno || null,
      apellido_materno: apellido_materno || null,
      dni:      dni      || null,
      email:    email    || null,
      telefono: telefono || null,
      foto_url,
      notas:    notas    || null,
    });
    res.status(201).json(cliente);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', [
  validators.mongoId('id', 'param'),
  validators.telefono(false),
  validators.dni(),
  validators.email()
], handleValidationErrors, async (req, res) => {
  const { nombre, apellido_paterno, apellido_materno, dni, email, telefono, notas, activo } = req.body;
  try {
    const current = await Cliente.findById(req.params.id);
    let foto_url = current?.foto_url;
    if (req.files?.foto) {
      await deleteImage(foto_url);
      foto_url = await saveImage(req.files.foto.data, 'clientes', req.files.foto.name);
    }
    const cliente = await Cliente.findByIdAndUpdate(
      req.params.id,
      {
        nombre,
        apellido_paterno: apellido_paterno || null,
        apellido_materno: apellido_materno || null,
        dni:      dni      || null,
        email:    email    || null,
        telefono: telefono || null,
        foto_url,
        notas:    notas    || null,
        activo:   activo !== undefined ? activo : true,
      },
      { new: true }
    );
    res.json(cliente);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', [
  validators.mongoId('id', 'param')
], handleValidationErrors, async (req, res) => {
  try {
    const c = await Cliente.findById(req.params.id);
    await deleteImage(c?.foto_url);
    await Cliente.findByIdAndDelete(req.params.id);
    res.json({ message: 'Cliente eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
