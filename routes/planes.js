const router = require('express').Router();
const Plan = require('../models/Plan');
const Membresia = require('../models/Membresia');
const { condicionesPlan } = require('../utils/asistenciaPolicy');
const { verifyToken, requireRole } = require('../middleware/auth');

// Ruta pública para landing
router.get('/public', async (req, res) => {
  try {
    const planes = await Plan.find({ mostrar_landing: true, activo: true })
      .select('nombre precio descripcion caracteristicas destacado')
      .sort({ precio: 1 });
    // Cache de 5 minutos en CDN/browser — los planes no cambian frecuentemente
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(planes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.use(verifyToken);

function validarLimite(req, res, next) {
  const value = req.body.limite_semanal;
  if (value !== undefined && value !== null &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 7)) {
    return res.status(400).json({ error: 'El límite semanal debe ser un entero de 1 a 7, o null para sin límite semanal.' });
  }
  if (req.body.aplicar_membresias !== undefined && typeof req.body.aplicar_membresias !== 'boolean') {
    return res.status(400).json({ error: 'aplicar_membresias debe ser booleano.' });
  }
  next();
}

router.get('/', async (req, res) => {
  try {
    const planes = await Plan.find().sort({ precio: 1 });
    res.json(planes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireRole('admin'), validarLimite, async (req, res) => {
  const { nombre, precio, duracion_dias, descripcion, caracteristicas, mostrar_landing, destacado } = req.body;
  try {
    const feats = Array.isArray(caracteristicas) ? caracteristicas
      : (caracteristicas ? caracteristicas.split('\n').map(f => f.trim()).filter(Boolean) : []);
    const plan = await Plan.create({
      nombre, precio, duracion_dias, descripcion, caracteristicas: feats,
      limite_semanal: req.body.limite_semanal ?? null,
      mostrar_landing: mostrar_landing || false, destacado: destacado || false,
    });
    res.status(201).json(plan);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireRole('admin'), validarLimite, async (req, res) => {
  const { nombre, precio, duracion_dias, descripcion, caracteristicas, mostrar_landing, destacado, activo } = req.body;
  try {
    const anterior = await Plan.findById(req.params.id);
    if (!anterior) return res.status(404).json({ error: 'Plan no encontrado.' });
    // Congelar las condiciones previas de contratos antiguos antes de editar.
    await Membresia.updateMany({ plan_id: anterior._id, condiciones_asistencia: { $exists: false } },
      { $set: { condiciones_asistencia: condicionesPlan(anterior) } });
    const feats = Array.isArray(caracteristicas) ? caracteristicas
      : (caracteristicas ? caracteristicas.split('\n').map(f => f.trim()).filter(Boolean) : []);
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { nombre, precio, duracion_dias, descripcion, caracteristicas: feats, mostrar_landing: mostrar_landing || false, destacado: destacado || false, activo,
        limite_semanal: req.body.limite_semanal === undefined ? anterior.limite_semanal : req.body.limite_semanal },
      { new: true, runValidators: true }
    );
    if (req.body.aplicar_membresias === true) {
      await Membresia.updateMany({ plan_id: plan._id, estado: { $in: ['activo', 'pendiente'] } },
        { $set: { condiciones_asistencia: condicionesPlan(plan) } });
      const now = new Date();
      await Membresia.updateMany({ estado: { $in: ['activo', 'pendiente'] }, 'periodos.plan_id': plan._id },
        { $set: { 'periodos.$[periodo].condiciones_asistencia': condicionesPlan(plan) } },
        { arrayFilters: [{ 'periodo.plan_id': plan._id, 'periodo.fecha_inicio': { $lte: now },
          'periodo.fecha_fin': { $gt: now } }] });
    }
    res.json(plan);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await Plan.findByIdAndDelete(req.params.id);
    res.json({ message: 'Plan eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
