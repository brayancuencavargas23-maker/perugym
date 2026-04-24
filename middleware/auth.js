const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

/**
 * Verifica el JWT y comprueba que el usuario siga activo en la base de datos.
 * Un usuario desactivado no puede operar aunque su token aún no haya expirado.
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verificar que el usuario siga existiendo y esté activo
    const user = await Usuario.findById(decoded.id).select('activo rol').lean();
    if (!user || !user.activo) {
      return res.status(401).json({ error: 'Usuario inactivo o eliminado' });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
};

/**
 * Aplica headers HTTP que impiden al navegador cachear páginas protegidas.
 * Debe usarse en todas las rutas HTML del panel administrativo para que
 * el botón "atrás" no muestre contenido tras el logout.
 */
const noCache = (_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma':        'no-cache',
    'Expires':       '0',
    'Surrogate-Control': 'no-store',
  });
  next();
};

module.exports = { verifyToken, requireRole, noCache };
