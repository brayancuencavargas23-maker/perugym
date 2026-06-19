const router = require('express').Router();
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const Solicitud = require('../models/Solicitud');
const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const Pago = require('../models/Pago');
const Plan = require('../models/Plan');
const { verifyToken, requireRole } = require('../middleware/auth');
const { requireCajaAbierta } = require('../middleware/cajaAbierta');
const TransactionManager = require('../utils/TransactionManager');
const MembresiaService = require('../services/MembresiaService');
const { asyncHandler } = require('../middleware/errorHandler');
const { validators, handleValidationErrors } = require('../middleware/validation');
const logger = require('../utils/logger');

// ── Rate limiting específico para el endpoint público ─────────────────────────
const rateLimit = require('express-rate-limit');

const solicitudLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,                    // máximo 5 solicitudes por IP en 15 min
  keyGenerator: (req) => req.ip,
  handler: (_req, res) => res.status(429).json({
    error: 'Demasiadas solicitudes. Por favor espera unos minutos antes de intentar de nuevo.',
  }),
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helper: consultar RENIEC ──────────────────────────────────────────────────
async function consultarReniec(dni) {
  const apiUrl = process.env.RENIEC_API_URL;
  const token  = process.env.RENIEC_API_TOKEN;
  if (!apiUrl || !token || !/^\d{8}$/.test(dni)) return null;
  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const res = await fetch(`${apiUrl}?numero=${encodeURIComponent(dni)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error('RENIEC timeout', { dni, service: 'RENIEC' });
    }
    return null;
  }
}

// ── POST /public — recibir solicitud desde la landing (sin auth) ──────────────
router.post(
  '/public',
  solicitudLimiter,
  [
    // Nombre: requerido, solo letras y espacios, entre 3 y 80 caracteres
    body('nombre')
      .trim()
      .notEmpty().withMessage('El nombre es requerido.')
      .isLength({ min: 3, max: 80 }).withMessage('El nombre debe tener entre 3 y 80 caracteres.')
      .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/).withMessage('El nombre solo puede contener letras y espacios.'),

    // DNI: opcional, 8 dígitos
    body('dni')
      .optional({ checkFalsy: true })
      .trim()
      .matches(/^\d{8}$/).withMessage('El DNI debe tener exactamente 8 dígitos.'),

    // Teléfono: exactamente 9 dígitos, debe empezar con 9 (celular peruano)
    body('telefono')
      .trim()
      .notEmpty().withMessage('El teléfono es requerido.')
      .customSanitizer(val => val.replace(/\D/g, ''))
      .isLength({ min: 9, max: 9 }).withMessage('El teléfono debe tener exactamente 9 dígitos.')
      .matches(/^9\d{8}$/).withMessage('El número debe empezar con 9 (celular peruano).'),

    // Email: opcional
    body('email')
      .optional({ checkFalsy: true })
      .trim()
      .isEmail().withMessage('El email no tiene un formato válido.')
      .normalizeEmail()
      .isLength({ max: 100 }).withMessage('El email es demasiado largo.'),

    // plan_id: debe ser un ObjectId válido de MongoDB
    body('plan_id')
      .isMongoId().withMessage('Plan inválido.'),

    // Honeypot
    body('website')
      .isEmpty().withMessage('Bot detectado.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const isHoneypot = errors.array().some(e => e.msg === 'Bot detectado.');
      if (isHoneypot) return res.status(200).json({ ok: true });
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { nombre, dni, telefono, email, plan_id } = req.body;
    try {
      const plan = await Plan.findOne({ _id: plan_id, activo: true, mostrar_landing: true });
      if (!plan) return res.status(404).json({ error: 'Plan no disponible.' });

      const hace10min = new Date(Date.now() - 10 * 60 * 1000);
      const duplicado = await Solicitud.findOne({ telefono, plan_id, created_at: { $gte: hace10min } });
      if (duplicado) return res.status(200).json({ ok: true });

      const solicitud = await Solicitud.create({
        nombre,
        dni: dni || null,
        telefono,
        email: email || null,
        plan_id,
      });
      res.status(201).json({ ok: true, id: solicitud._id });
    } catch (err) {
      res.status(500).json({ error: 'No se pudo registrar la solicitud. Intenta de nuevo.' });
    }
  }
);

// ── Todas las rutas siguientes requieren autenticación ────────────────────────
router.use(verifyToken);

// ── GET / — listar solicitudes con filtros y paginación ───────────────────────
router.get('/', async (req, res) => {
  const { estado, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (estado) filter.estado = estado;

  try {
    const total = await Solicitud.countDocuments(filter);
    const solicitudes = await Solicitud.find(filter)
      .populate('plan_id', 'nombre precio')
      .populate('atendido_por', 'nombre')
      .populate('cliente_id', 'nombre')
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const data = solicitudes.map(s => ({
      ...s.toObject(),
      id: String(s._id),
      plan_nombre: s.plan_id?.nombre,
      plan_precio: s.plan_id?.precio,
      atendido_por_nombre: s.atendido_por?.nombre || null,
      cliente_nombre: s.cliente_id?.nombre || null,
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /stats — conteo por estado para el badge del sidebar y dashboard ──────
router.get('/stats', async (req, res) => {
  try {
    const [pendiente, contactado, convertido, descartado] = await Promise.all([
      Solicitud.countDocuments({ estado: 'pendiente' }),
      Solicitud.countDocuments({ estado: 'contactado' }),
      Solicitud.countDocuments({ estado: 'convertido' }),
      Solicitud.countDocuments({ estado: 'descartado' }),
    ]);
    res.json({ pendiente, contactado, convertido, descartado, total: pendiente + contactado + convertido + descartado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/estado — cambiar estado + notas ──────────────────────────────────
router.put(
  '/:id/estado',
  [
    param('id').isMongoId().withMessage('ID inválido.'),
    body('estado').isIn(['pendiente', 'contactado', 'convertido', 'descartado']).withMessage('Estado inválido.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { estado, notas } = req.body;
    try {
      const update = { estado, atendido_por: req.user.id };
      if (notas !== undefined) update.notas = notas;
      await Solicitud.findByIdAndUpdate(req.params.id, update, { new: true });
      const sol = await Solicitud.findById(req.params.id)
        .populate('plan_id', 'nombre precio')
        .populate('atendido_por', 'nombre')
        .populate('cliente_id', 'nombre');
      if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada.' });
      res.json({
        ...sol.toObject(),
        id: sol._id,
        plan_nombre: sol.plan_id?.nombre,
        plan_precio: sol.plan_id?.precio,
        atendido_por_nombre: sol.atendido_por?.nombre || null,
        cliente_nombre: sol.cliente_id?.nombre || null,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ── POST /:id/convertir — convierte lead en cliente + membresía + pago ─────────
router.post(
  '/:id/convertir',
  requireCajaAbierta,
  [
    param('id').isMongoId().withMessage('ID inválido.'),
    body('dni').optional({ checkFalsy: true }).trim(),
    body('nombre').optional({ checkFalsy: true }).trim(),
    body('apellido_paterno').optional({ checkFalsy: true }).trim(),
    body('apellido_materno').optional({ checkFalsy: true }).trim(),
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
    body('estado_pago').optional().isIn(['pagado', 'pendiente']),
    validators.fecha('fecha_inicio'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { dni, nombre: nombreOverride, apellido_paterno: apOverride, apellido_materno: amOverride,
            metodo_pago = 'efectivo', estado_pago = 'pagado', fecha_inicio, notas_membresia } = req.body;
    const caja_id = req.cajaActual._id;

    const result = await TransactionManager.execute(async (session) => {
      // Get solicitud with plan details
      const sol = await Solicitud.findById(req.params.id).populate('plan_id').session(session);
      if (!sol) {
        const error = new Error('Solicitud no encontrada.');
        error.statusCode = 404;
        throw error;
      }
      if (sol.estado === 'convertido') {
        const error = new Error('Esta solicitud ya fue convertida.');
        error.statusCode = 400;
        throw error;
      }
      if (sol.estado === 'descartado') {
        const error = new Error('No se puede convertir una solicitud descartada.');
        error.statusCode = 400;
        throw error;
      }

      const plan = sol.plan_id;
      if (!plan || !plan.activo) {
        const error = new Error('El plan de esta solicitud ya no está disponible.');
        error.statusCode = 400;
        throw error;
      }

      // Prepare client data — priority: form overrides > RENIEC > solicitud data
      let nombreCliente   = nombreOverride || sol.nombre;
      let apellidoPaterno = apOverride     || sol.apellido_paterno || null;
      let apellidoMaterno = amOverride     || sol.apellido_materno || null;

      // If DNI provided and no manual overrides, consult RENIEC
      const sinOverride = !nombreOverride && !apOverride && !amOverride;
      if (dni && sinOverride) {
        const reniec = await consultarReniec(dni);
        if (reniec) {
          nombreCliente   = reniec.first_name       || nombreCliente;
          apellidoPaterno = reniec.first_last_name  || apellidoPaterno;
          apellidoMaterno = reniec.second_last_name || apellidoMaterno;
        }
      }

      // Create client
      const [cliente] = await Cliente.create(
        [{
          nombre:           nombreCliente,
          apellido_paterno: apellidoPaterno,
          apellido_materno: apellidoMaterno,
          telefono:         sol.telefono,
          email:            sol.email || null,
          dni:              dni || sol.dni || null,
        }],
        { session }
      );

      // Create membership using MembresiaService
      const membresia = await MembresiaService.crear({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio,
        estado_pago
      }, session);

      // Create payment
      const [pago] = await Pago.create(
        [{
          cliente_id: cliente._id,
          membresia_id: membresia._id,
          caja_id,
          monto: plan.precio,
          metodo_pago,
          estado: estado_pago,
          notas: notas_membresia || null
        }],
        { session }
      );

      // Mark solicitud as converted
      await Solicitud.findByIdAndUpdate(
        req.params.id,
        { estado: 'convertido', cliente_id: cliente._id, atendido_por: req.user.id },
        { session }
      );

      return { cliente, membresia, pago };
    });

    res.status(201).json(result);
  })
);

// ── DELETE /:id — eliminar solicitud (solo admin) ─────────────────────────────
router.delete('/:id', requireRole('admin'), [
  param('id').isMongoId().withMessage('ID inválido.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  try {
    const sol = await Solicitud.findByIdAndDelete(req.params.id);
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    res.json({ message: 'Solicitud eliminada.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
