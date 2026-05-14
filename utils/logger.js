/**
 * Structured logging utility
 * Logs in JSON format with timestamp, level, and context
 */

const logLevels = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

/**
 * Create a structured log entry
 * @param {string} level - Log level (error, warn, info, debug)
 * @param {string} message - Log message
 * @param {Object} context - Additional context (method, route, error, etc.)
 */
function log(level, message, context = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  };

  const logString = JSON.stringify(logEntry);

  switch (level) {
    case logLevels.ERROR:
      console.error(logString);
      break;
    case logLevels.WARN:
      console.warn(logString);
      break;
    case logLevels.INFO:
      console.info(logString);
      break;
    case logLevels.DEBUG:
      console.log(logString);
      break;
    default:
      console.log(logString);
  }
}

/**
 * Log an error with context
 * @param {string} message - Error message
 * @param {Object} context - Additional context
 */
function error(message, context = {}) {
  log(logLevels.ERROR, message, context);
}

/**
 * Log a warning with context
 * @param {string} message - Warning message
 * @param {Object} context - Additional context
 */
function warn(message, context = {}) {
  log(logLevels.WARN, message, context);
}

/**
 * Log an info message with context
 * @param {string} message - Info message
 * @param {Object} context - Additional context
 */
function info(message, context = {}) {
  log(logLevels.INFO, message, context);
}

/**
 * Log a debug message with context
 * @param {string} message - Debug message
 * @param {Object} context - Additional context
 */
function debug(message, context = {}) {
  log(logLevels.DEBUG, message, context);
}

/**
 * Create a logger with request context
 * @param {Object} req - Express request object
 * @returns {Object} Logger with request context
 */
function withRequest(req) {
  const requestContext = {
    method: req.method,
    route: req.originalUrl || req.url,
    ip: req.ip,
    userId: req.user?.id
  };

  return {
    error: (message, context = {}) => error(message, { ...requestContext, ...context }),
    warn: (message, context = {}) => warn(message, { ...requestContext, ...context }),
    info: (message, context = {}) => info(message, { ...requestContext, ...context }),
    debug: (message, context = {}) => debug(message, { ...requestContext, ...context })
  };
}

module.exports = {
  error,
  warn,
  info,
  debug,
  withRequest,
  logLevels
};
