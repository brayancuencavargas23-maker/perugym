const { AppError } = require('./errors/ErrorTypes');
const logger = require('../utils/logger');

/**
 * Sanitize request body to avoid logging sensitive information
 * @param {Object} body - Request body
 * @returns {Object} - Sanitized body
 */
function sanitizeBody(body) {
  if (!body) return {};
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  return sanitized;
}

/**
 * Centralized error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  // Log error with structured logging
  const errorContext = {
    path: req.path,
    query: req.query,
    body: sanitizeBody(req.body),
    error: {
      name: err.name,
      message: err.message,
      statusCode: err.statusCode || 500
    },
    user: req.user?.id || 'anonymous',
    ip: req.ip
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorContext.stack = err.stack;
  }

  logger.withRequest(req).error('Request error', errorContext);

  // Operational errors (known errors)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message
    });
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: Object.values(err.errors)[0].message
    });
  }

  // Mongoose cast errors (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: `${err.path} inválido.`
    });
  }

  // MongoDB duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      error: `Ya existe un registro con ese ${field}.`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Token inválido.'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expirado.'
    });
  }

  // Unhandled error - don't expose details in production
  const isDev = process.env.NODE_ENV === 'development';
  res.status(500).json({
    error: isDev ? err.message : 'Error interno del servidor.'
  });
};

/**
 * Wrapper for async route handlers to catch errors automatically
 * @param {Function} fn - Async route handler
 * @returns {Function} - Wrapped handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };
