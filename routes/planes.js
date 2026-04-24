const router = require('express').Router();
const Plan = require('../models/Plan');
const { verifyToken, requireRole } = require('../middleware/auth');

// Ruta pública para landing
router.get('/public', async (req, res) => {
  try {
    const planes = await Plan.find({ mostrar_landing: true, activo: true })
      .select('nombre precio descripcion caracteristicas destacado')
      .sort({ precio: 1 });
    res.json(planes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const planes = await Plan.find().sort({ precio: 1 });
    res.json(planes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { nombre, precio, duracion_dias, descripcion, caracteristicas, mostrar_landing, destacado } = req.body;
  try {
    const feats = Array.isArray(caracteristicas) ? caracteristicas
      : (caracteristicas ? caracteristicas.split('\n').map(f => f.trim()).filter(Boolean) : []);
    const plan = await Plan.create({
      nombre, precio, duracion_dias, descripcion, caracteristicas: feats,
      mostrar_landing: mostrar_landing || false, destacado: destacado || false,
    });
    res.status(201).json(plan);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { nombre, precio, duracion_dias, descripcion, caracteristicas, mostrar_landing, destacado, activo } = req.body;
  try {
    const feats = Array.isArray(caracteristicas) ? caracteristicas
      : (caracteristicas ? caracteristicas.split('\n').map(f => f.trim()).filter(Boolean) : []);
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { nombre, precio, duracion_dias, descripcion, caracteristicas: feats, mostrar_landing: mostrar_landing || false, destacado: destacado || false, activo },
      { new: true }
    );
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
