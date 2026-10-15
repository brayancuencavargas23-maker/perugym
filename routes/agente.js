const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { verifyToken, requireRole } = require('../middleware/auth');
const Operaciones = require('../services/AsistenteOperacionesService');
const { chat, limpiarHistorial, obtenerHistorial } = require('../services/AgenteService');

// Rate limiting para el agente: 30 consultas por 15 minutos por usuario
const agenteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AGENT_RATE_LIMIT) || 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Has excedido el límite de consultas al agente. Espera 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(verifyToken);

// Accesos directos: funcionan también cuando el proveedor IA no está disponible.
const operacion = fn => async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await fn(req)); }
  catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo completar la operación. Intenta de nuevo.' }); }
};
router.get('/reporte', requireRole('admin', 'recepcionista'), operacion(req => Operaciones.generarReporte(req.query)));
router.get('/recomendaciones', requireRole('admin', 'recepcionista'), operacion(req => Operaciones.recomendaciones(req.query)));
router.get('/clientes', requireRole('admin', 'recepcionista'), operacion(req => Operaciones.buscarClientes(req.query.q)));
router.post('/mensaje', requireRole('admin', 'recepcionista'), operacion(req => Operaciones.prepararMensaje(req.body)));

// POST /api/agente/chat
router.post('/chat', agenteLimiter, async (req, res) => {
  try {
    const { mensaje } = req.body;

    if (!mensaje || typeof mensaje !== 'string' || mensaje.trim().length === 0) {
      return res.status(400).json({ error: 'El mensaje es requerido y no puede estar vacío.' });
    }

    if (mensaje.length > 500) {
      return res.status(400).json({ error: 'El mensaje no puede tener más de 500 caracteres.' });
    }

    const usuarioId = req.user.id;
    const resultado = await chat(mensaje.trim(), usuarioId, req.user);

    res.json(resultado);
  } catch (error) {
    console.error('[Agente Route] Error:', error);
    res.status(500).json({ error: 'Error interno al procesar la consulta.' });
  }
});

// GET /api/agente/historial
router.get('/historial', (req, res) => {
  const usuarioId = req.user.id;
  const historial = obtenerHistorial(usuarioId);
  res.json({ historial });
  });

// DELETE /api/agente/historial
router.delete('/historial', (req, res) => {
  const usuarioId = req.user.id;
  limpiarHistorial(usuarioId);
  res.json({ mensaje: 'Historial limpiado correctamente.' });
});

module.exports = router;
