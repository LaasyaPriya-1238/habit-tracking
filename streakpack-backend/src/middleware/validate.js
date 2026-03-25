// src/middleware/validate.js
// Lightweight validation helpers — no external library needed.

const { httpError } = require('./errorHandler');

const VALID_CATEGORIES  = ['Coding','Fitness','Study','Music','Art','Dance','Wellness','Custom'];
const VALID_TYPES       = ['competitive','individual'];
const VALID_PROOF       = ['none','screenshot','gps','photo','timer','manual'];
const VALID_PENALTY     = ['points','charity'];
const VALID_STATUS      = ['done','cheat','missed'];

/**
 * Validates the body for POST /habits and PATCH /habits/:id
 */
function validateHabitBody(req, res, next) {
  const { name, category, type, duration_min, proof_method, penalty_type } = req.body;
  const isCreate = req.method === 'POST';

  if (isCreate && (!name || typeof name !== 'string' || !name.trim())) {
    return next(httpError(400, '"name" is required and must be a non-empty string.'));
  }

  if (name !== undefined && typeof name !== 'string') {
    return next(httpError(400, '"name" must be a string.'));
  }

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    return next(httpError(400, `"category" must be one of: ${VALID_CATEGORIES.join(', ')}`));
  }

  if (type !== undefined && !VALID_TYPES.includes(type)) {
    return next(httpError(400, `"type" must be one of: ${VALID_TYPES.join(', ')}`));
  }

  if (duration_min !== undefined) {
    const d = Number(duration_min);
    if (!Number.isInteger(d) || d < 1 || d > 1440) {
      return next(httpError(400, '"duration_min" must be an integer between 1 and 1440.'));
    }
    req.body.duration_min = d;
  }

  if (proof_method !== undefined && !VALID_PROOF.includes(proof_method)) {
    return next(httpError(400, `"proof_method" must be one of: ${VALID_PROOF.join(', ')}`));
  }

  if (penalty_type !== undefined && !VALID_PENALTY.includes(penalty_type)) {
    return next(httpError(400, `"penalty_type" must be one of: ${VALID_PENALTY.join(', ')}`));
  }

  next();
}

/**
 * Validates the body for POST /habits/:id/checkins
 */
function validateCheckinBody(req, res, next) {
  const { checked_date, status } = req.body;

  if (!checked_date) {
    return next(httpError(400, '"checked_date" is required (YYYY-MM-DD).'));
  }

  // Must be a valid date string
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(checked_date) || isNaN(new Date(checked_date).getTime())) {
    return next(httpError(400, '"checked_date" must be a valid date in YYYY-MM-DD format.'));
  }

  // Cannot check-in for a future date
  const today = new Date().toISOString().split('T')[0];
  if (checked_date > today) {
    return next(httpError(400, 'Cannot check-in for a future date.'));
  }

  if (status !== undefined && !VALID_STATUS.includes(status)) {
    return next(httpError(400, `"status" must be one of: ${VALID_STATUS.join(', ')}`));
  }

  next();
}

module.exports = { validateHabitBody, validateCheckinBody };
