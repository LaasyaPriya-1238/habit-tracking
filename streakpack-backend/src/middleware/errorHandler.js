// src/middleware/errorHandler.js
// Central error-handling middleware — catches any error thrown in route handlers.

/**
 * Express error handler.
 * Usage: app.use(errorHandler)  ← must be last middleware.
 */
function errorHandler(err, req, res, next) {  // eslint-disable-line no-unused-vars
  const status  = err.status  || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log full stack in dev
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ERROR] ${req.method} ${req.path} →`, err.stack || err);
  }

  res.status(status).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
}

/**
 * Wrap async route handlers so thrown errors reach errorHandler automatically.
 * Usage: router.get('/path', asyncWrap(async (req, res) => { ... }))
 */
function asyncWrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Create an HTTP error with a status code.
 * Usage: throw httpError(404, 'Habit not found')
 */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { errorHandler, asyncWrap, httpError };
