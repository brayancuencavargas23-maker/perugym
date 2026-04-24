const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * Logout: aunque JWT es stateless, este endpoint permite al cliente
 * hacer una llamada explícita de cierre de sesión. El frontend debe
 * eliminar el token de localStorage al recibir la respuesta.
 * Los headers no-store evitan que la respuesta quede en caché.
 */
router.post('/logout', verifyToken, (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma':        'no-cache',
    'Expires':       '0',
  });
  res.json({ message: 'Sesión cerrada correctamente' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await Usuario.findOne({ usuario: username, activo: true });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const permisos = user.rol === 'admin' ? [] : (user.permisos || []);
    const token = jwt.sign(
      { id: user._id, name: user.usuario, email: user.email, role: user.rol, permisos },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ token, user: { id: user._id, name: user.usuario, email: user.email, role: user.rol, permisos } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const users = await Usuario.find({}, { password: 0 }).sort({ created_at: 1 });
    res.json(users.map(u => ({
      id: u._id, name: u.usuario, email: u.email, role: u.rol,
      active: u.activo, permisos: u.permisos, created_at: u.created_at,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users', verifyToken, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await Usuario.create({ usuario: name, email, password: hash, rol: role });
    res.status(201).json({ id: user._id, name: user.usuario, email: user.email, role: user.rol });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { name, email, role, active, password } = req.body;
  try {
    const update = { usuario: name, email, rol: role, activo: active };
    if (password) update.password = await bcrypt.hash(password, 10);
    const user = await Usuario.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ id: user._id, name: user.usuario, email: user.email, role: user.rol, active: user.activo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    await Usuario.findByIdAndDelete(req.params.id);
    res.json({ message: 'Usuario eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id/permisos', verifyToken, requireRole('admin'), async (req, res) => {
  const { permisos } = req.body;
  try {
    await Usuario.findByIdAndUpdate(req.params.id, { permisos });
    res.json({ message: 'Permisos actualizados' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
