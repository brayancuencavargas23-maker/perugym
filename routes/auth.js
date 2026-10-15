const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { verifyToken, requireRole, isDeveloperUser } = require('../middleware/auth');
const { validators, handleValidationErrors } = require('../middleware/validation');
const { param } = require('express-validator');

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
    // Verificar usuario desarrollador (definido en .env, invisible en la BD)
    const devUsername = process.env.DEV_USERNAME;
    const devEmail    = process.env.DEV_EMAIL;
    const devHash     = process.env.DEV_PASSWORD_HASH;

    if (devUsername && devHash && username === devUsername) {
      const match = await bcrypt.compare(password, devHash);
      if (!match) return res.status(401).json({ error: 'Credenciales inválidas' });

      const token = jwt.sign(
        { id: 'dev', name: devUsername, email: devEmail, role: 'admin', permisos: [] },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );
      return res.json({ token, user: { id: 'dev', name: devUsername, email: devEmail, role: 'admin', permisos: [] } });
    }

    // Flujo normal para usuarios de la BD
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

/**
 * Renovación deslizante de sesión.
 * Mientras el token actual siga siendo válido, emitimos uno nuevo con los
 * datos frescos de la BD. Así la sesión se extiende mientras haya actividad
 * y ya no se corta en seco a los 7 días exactos (el usuario solo pierde la
 * sesión si pasa 7 días sin usar el sistema o si lo desactivan).
 */
const noStore = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma':        'no-cache',
  'Expires':       '0',
};

router.post('/refresh', verifyToken, async (req, res) => {
  res.set(noStore);
  try {
    let payload;
    if (isDeveloperUser(req.user.id)) {
      payload = {
        id: 'dev',
        name: req.user.name || process.env.DEV_USERNAME,
        email: req.user.email || process.env.DEV_EMAIL,
        role: 'admin',
        permisos: [],
      };
    } else {
      const user = await Usuario.findById(req.user.id).select('usuario email rol permisos').lean();
      if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
      payload = {
        id: user._id,
        name: user.usuario,
        email: user.email,
        role: user.rol,
        permisos: user.rol === 'admin' ? [] : (user.permisos || []),
      };
    }

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({
      token,
      user: { id: payload.id, name: payload.name, email: payload.email, role: payload.role, permisos: payload.permisos },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const devUsername = process.env.DEV_USERNAME;
    const users = await Usuario.find({}, { password: 0 }).sort({ created_at: 1 });
    res.json(
      users
        .filter(u => u.usuario !== devUsername)
        .map(u => ({
          id: u._id.toString(), name: u.usuario, email: u.email, role: u.rol,
          active: u.activo, permisos: u.permisos, created_at: u.created_at,
        }))
    );
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users', verifyToken, requireRole('admin'), [
  validators.email()
], handleValidationErrors, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await Usuario.create({ usuario: name, email, password: hash, rol: role || 'recepcionista' });
    res.status(201).json({ id: user._id.toString(), name: user.usuario, email: user.email, role: user.rol });
  } catch (err) {
    if (err.code === 11000) {
      const field = err.keyPattern?.usuario ? 'nombre de usuario' : 'email';
      return res.status(409).json({ error: `Ya existe un usuario con ese ${field}` });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', verifyToken, requireRole('admin'), [
  validators.mongoId('id', 'param'),
  validators.email()
], handleValidationErrors, async (req, res) => {
  const { name, email, role, active } = req.body;
  if (role !== undefined && !['admin', 'recepcionista'].includes(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  try {
    const target = await Usuario.findById(req.params.id).select('usuario rol activo').lean();
    if (target && target.usuario === process.env.DEV_USERNAME) {
      return res.status(403).json({ error: 'Este usuario no puede ser modificado' });
    }
    // Siempre debe quedar al menos un administrador activo: si la edición
    // quita el rol admin o desactiva al único admin, el sistema quedaría
    // sin nadie capaz de gestionarlo.
    const nuevoRol    = role    !== undefined ? role    : target?.rol;
    const nuevoActivo = active  !== undefined ? !!active : target?.activo;
    if (target?.rol === 'admin' && (nuevoRol !== 'admin' || !nuevoActivo)) {
      const otrosAdmins = await Usuario.countDocuments({ rol: 'admin', activo: true, _id: { $ne: target._id } });
      if (!otrosAdmins) {
        return res.status(403).json({ error: 'Debe quedar al menos un administrador activo. Crea otro admin antes de cambiar este.' });
      }
    }
    const update = {};
    if (name !== undefined)  update.usuario = name;
    if (email !== undefined) update.email = email;
    if (role !== undefined)  update.rol = role;
    if (active !== undefined) update.activo = !!active;
    const user = await Usuario.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ id: user._id.toString(), name: user.usuario, email: user.email, role: user.rol, active: user.activo });
  } catch (err) {
    if (err.code === 11000) {
      const field = err.keyPattern?.usuario ? 'nombre de usuario' : 'email';
      return res.status(409).json({ error: `Ya existe un usuario con ese ${field}` });
    }
    res.status(500).json({ error: err.message });
  }
});

// Cambio de contraseña: requiere confirmar la contraseña actual del admin que hace la acción
router.put('/users/:id/password', verifyToken, requireRole('admin'), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'La contraseña actual y la nueva son requeridas' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const target = await Usuario.findById(req.params.id).select('usuario').lean();
    if (target && target.usuario === process.env.DEV_USERNAME) {
      return res.status(403).json({ error: 'Este usuario no puede ser modificado' });
    }
    // Verificar la contraseña actual del admin que está haciendo el cambio (req.user.id viene del token)
    if (req.user.id === 'dev') {
      // El usuario desarrollador no vive en la BD; verificar contra el hash del .env
      const devHash = process.env.DEV_PASSWORD_HASH;
      if (!devHash || !(await bcrypt.compare(currentPassword, devHash))) {
        return res.status(401).json({ error: 'Tu contraseña actual es incorrecta' });
      }
    } else {
      const admin = await Usuario.findById(req.user.id);
      if (!admin || !(await bcrypt.compare(currentPassword, admin.password))) {
        return res.status(401).json({ error: 'Tu contraseña actual es incorrecta' });
      }
    }
    const hash = await bcrypt.hash(newPassword, 10);
    const user = await Usuario.findByIdAndUpdate(req.params.id, { password: hash }, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id', verifyToken, requireRole('admin'), [
  validators.mongoId('id', 'param'),
], handleValidationErrors, async (req, res) => {
  try {
    const target = await Usuario.findById(req.params.id).select('usuario rol activo').lean();
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.usuario === process.env.DEV_USERNAME) {
      return res.status(403).json({ error: 'Este usuario no puede ser eliminado' });
    }
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(403).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    if (target.rol === 'admin') {
      return res.status(403).json({ error: 'Las cuentas administradoras no se pueden eliminar. Si ya no la necesitas, desáctívala en Editar.' });
    }
    await Usuario.findByIdAndDelete(req.params.id);
    res.json({ message: 'Usuario eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id/permisos', verifyToken, requireRole('admin'), async (req, res) => {
  const { permisos } = req.body;
  const permitidos = ['dashboard', 'clientes', 'membresias', 'pagos', 'planes', 'asistencia', 'productos', 'compras', 'caja', 'reports', 'solicitudes'];
  if (!Array.isArray(permisos) || permisos.length > permitidos.length || permisos.some(p => !permitidos.includes(p))) {
    return res.status(400).json({ error: 'Envía una lista de permisos válidos.' });
  }
  if (!require('mongoose').isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Usuario inválido.' });
  try {
    const user = await Usuario.findByIdAndUpdate(req.params.id, { permisos: [...new Set(permisos)] }, { runValidators: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ message: 'Permisos actualizados' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
