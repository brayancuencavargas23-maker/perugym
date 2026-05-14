const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

/**
 * Check if a user ID corresponds to the developer user
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if user is developer
 */
const isDeveloperUser = (userId) => {
  return userId === 'dev';
};

/**
 * Check if a username corresponds to the developer username from env
 * @param {string} username - Username to check
 * @returns {boolean} - True if username matches developer username
 */
const isDeveloperUsername = (username) => {
  const devUsername = process.env.DEV_USERNAME;
  return !!(devUsername && username === devUsername);
};

/**
 * Middleware to prevent modification or deletion of developer user
 * Should be used before any operation that modifies or deletes a user
 * @param {string} userIdParam - Name of the route parameter containing user ID (default: 'id')
 */
const protectDeveloperUser = (userIdParam = 'id') => async (req, res, next) => {
  try {
    const targetUserId = req.params[userIdParam];
    
    // Check if target is developer user by ID
    if (isDeveloperUser(targetUserId)) {
      return res.status(403).json({ 
        error: 'El usuario desarrollador no puede ser modificado o eliminado' 
      });
    }

    // Check if target is developer user by username (requires DB lookup)
    const target = await Usuario.findById(targetUserId).select('usuario').lean();
    if (target && isDeveloperUsername(target.usuario)) {
      return res.status(403).json({ 
        error: 'El usuario desarrollador no puede ser modificado o eliminado' 
      });
    }

    next();
  } catch (error) {
    // If user not found, let the route handler deal with it
    next();
  }
};

/**
 * Verifica el JWT y comprueba que el usuario siga activo en la base de datos.
 * Un usuario desactivado no puede operar aunque su token aún no haya expirado.
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');

    // El usuario desarrollador vive solo en el token (no está en la BD)
    if (isDeveloperUser(decoded.id)) {
      req.user = decoded;
      return next();
    }

    // Verificar que el usuario siga existiendo y esté activo
    try {
      const user = await Usuario.findById(decoded.id).select('activo rol').lean();
      if (!user || !user.activo) {
        return res.status(401).json({ error: 'Usuario inactivo o eliminado' });
      }

      req.user = decoded;
      next();
    } catch (dbError) {
      // Error de base de datos (usuario no encontrado, etc.)
      return res.status(401).json({ error: 'Usuario inactivo o eliminado' });
    }
  } catch (jwtError) {
    // Error de JWT (token inválido o expirado)
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

module.exports = { 
  verifyToken, 
  requireRole, 
  noCache, 
  protectDeveloperUser,
  isDeveloperUser,
  isDeveloperUsername
};
