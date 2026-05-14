const router = require('express').Router();
const mongoose = require('mongoose');

/**
 * Health check endpoint
 * Returns 200 if everything is OK, 503 if there are problems
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {}
  };

  // Check MongoDB connection
  try {
    const dbState = mongoose.connection.readyState;
    const dbStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    health.checks.database = {
      status: dbState === 1 ? 'ok' : 'error',
      state: dbStates[dbState],
      host: mongoose.connection.host
    };

    if (dbState !== 1) {
      health.status = 'error';
    }
  } catch (err) {
    health.checks.database = {
      status: 'error',
      error: err.message
    };
    health.status = 'error';
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  health.checks.memory = {
    status: 'ok',
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
  };

  // Return appropriate status code
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
