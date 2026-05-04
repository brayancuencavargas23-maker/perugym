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

    // Teléfono: exactamente 9 dígitos, debe empezar con 9 (celular peruano)
    body('telefono')
      .trim()
      .notEmpty().withMessage('El teléfono es requerido.')
      .customSanitizer(val => val.replace(/\D/g, '')) // quitar no-dígitos antes de validar
      .isLength({ min: 9, max: 9 }).withMessage('El teléfono debe tener exactamente 9 dígitos.')
      .matches(/^9\d{8}$/).withMessage('El número debe empezar con 9 (celular peruano).'),

    // Email: opcional, pero si se envía debe ser válido y normalizado
    body('email')
      .optional({ checkFalsy: true })
      .trim()
      .isEmail().withMessage('El email no tiene un formato válido.')
      .normalizeEmail()
      .isLength({ max: 100 }).withMessage('El email es demasiado largo.'),

    // plan_id: debe ser un ObjectId válido de MongoDB
    body('plan_id')
      .isMongoId().withMessage('Plan inválido.'),

    // Honeypot: campo oculto que los bots suelen rellenar
    // Si viene con valor, es un bot — rechazar silenciosamente
    body('website')
      .isEmpty().withMessage('Bot detectado.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Si el honeypot fue activado, responder 200 para no revelar la detección
      const isHoneypot = errors.array().some(e => e.msg === 'Bot detectado.');
      if (isHoneypot) return res.status(200).json({ ok: true });
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { nombre, telefono, email, plan_id } = req.body;
    try {
      const plan = await Plan.findOne({ _id: plan_id, activo: true, mostrar_landing: true });
      if (!plan) return res.status(404).json({ error: 'Plan no disponible.' });

      // Verificar duplicado reciente: misma IP + mismo teléfono en los últimos 10 min
      // Evita que alguien envíe la misma solicitud múltiples veces
      const hace10min = new Date(Date.now() - 10 * 60 * 1000);
      const duplicado = await Solicitud.findOne({
        telefono,
        plan_id,
        created_at: { $gte: hace10min },
      });
      if (duplicado) {
        // Responder OK para no revelar que ya existe — el staff verá solo una
        return res.status(200).json({ ok: true });
      }

      const solicitud = await Solicitud.create({
        nombre,
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
      id: s._id,
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
      const sol = await Solicitud.findByIdAndUpdate(req.params.id, update, { new: true })
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
    body('metodo_pago').optional().isIn(['efectivo', 'yape', 'plin', 'transferencia']),
    body('estado_pago').optional().isIn(['pagado', 'pendiente']),
    body('fecha_inicio').optional().isISO8601().withMessage('Fecha de inicio inválida.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { dni, metodo_pago = 'efectivo', estado_pago = 'pagado', fecha_inicio, notas_membresia } = req.body;
    const caja_id = req.cajaActual._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const sol = await Solicitud.findById(req.params.id).populate('plan_id').session(session);
      if (!sol) { await session.abortTransaction(); return res.status(404).json({ error: 'Solicitud no encontrada.' }); }
      if (sol.estado === 'convertido') { await session.abortTransaction(); return res.status(400).json({ error: 'Esta solicitud ya fue convertida.' }); }
      if (sol.estado === 'descartado') { await session.abortTransaction(); return res.status(400).json({ error: 'No se puede convertir una solicitud descartada.' }); }

      const plan = sol.plan_id;
      if (!plan || !plan.activo) { await session.abortTransaction(); return res.status(400).json({ error: 'El plan de esta solicitud ya no está disponible.' }); }

      // Crear cliente
      const [cliente] = await Cliente.create(
        [{ nombre: sol.nombre, telefono: sol.telefono, email: sol.email || null, dni: dni || null }],
        { session }
      );

      // Crear membresía
      const inicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + plan.duracion_dias);
      const estadoMembresia = estado_pago === 'pendiente' ? 'pendiente' : 'activo';

      const [membresia] = await Membresia.create(
        [{ cliente_id: cliente._id, plan_id: plan._id, fecha_inicio: inicio, fecha_fin: fin, estado: estadoMembresia }],
        { session }
      );

      // Crear pago
      const [pago] = await Pago.create(
        [{ cliente_id: cliente._id, membresia_id: membresia._id, caja_id, monto: plan.precio, metodo_pago, estado: estado_pago, notas: notas_membresia || null }],
        { session }
      );

      // Marcar solicitud como convertida
      await Solicitud.findByIdAndUpdate(
        req.params.id,
        { estado: 'convertido', cliente_id: cliente._id, atendido_por: req.user.id },
        { session }
      );

      await session.commitTransaction();
      res.status(201).json({ cliente, membresia, pago });
    } catch (err) {
      await session.abortTransaction();
      res.status(500).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
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
