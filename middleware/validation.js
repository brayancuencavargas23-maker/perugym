const { body, param, query, validationResult } = require('express-validator');

/**
 * Middleware that checks validation results and returns 400 error if validation fails
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
};

/**
 * Reusable validators
 */
const validators = {
  /**
   * DNI validator - exactly 8 numeric digits
   */
  dni: () => body('dni')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^\d{8}$/)
    .withMessage('El DNI debe tener exactamente 8 dígitos.'),

  /**
   * Peruvian phone validator - 9 digits starting with 9
   * @param {boolean} required - Whether the field is required (default: true)
   */
  telefono: (required = true) => {
    const validator = body('telefono')
      .trim()
      .customSanitizer(val => val ? val.replace(/\D/g, '') : val);
    
    if (required) {
      return validator
        .notEmpty()
        .withMessage('El teléfono es requerido.')
        .isLength({ min: 9, max: 9 })
        .withMessage('El teléfono debe tener exactamente 9 dígitos.')
        .matches(/^9\d{8}$/)
        .withMessage('El número debe empezar con 9.');
    } else {
      return validator
        .optional({ checkFalsy: true })
        .isLength({ min: 9, max: 9 })
        .withMessage('El teléfono debe tener exactamente 9 dígitos.')
        .matches(/^9\d{8}$/)
        .withMessage('El número debe empezar con 9.');
    }
  },

  /**
   * Email validator with normalization
   */
  email: () => body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage('El email no tiene un formato válido.')
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage('El email es demasiado largo.'),

  /**
   * MongoDB ObjectId validator
   * @param {string} field - Field name (default: 'id')
   * @param {string} location - Location of field: 'param' or 'body' (default: 'param')
   */
  mongoId: (field = 'id', location = 'param') => {
    const validator = location === 'body' ? body : param;
    return validator(field)
      .isMongoId()
      .withMessage(`${field} inválido.`);
  },

  /**
   * Positive amount validator
   * @param {string} field - Field name (default: 'monto')
   */
  monto: (field = 'monto') => body(field)
    .isFloat({ min: 0.01 })
    .withMessage(`${field} debe ser mayor que 0.`),

  /**
   * ISO 8601 date validator
   * @param {string} field - Field name
   */
  fecha: (field) => body(field)
    .optional()
    .isISO8601()
    .withMessage(`${field} debe ser una fecha válida.`),

  /**
   * Enum validator
   * @param {string} field - Field name
   * @param {Array} values - Allowed values
   */
  enum: (field, values) => body(field)
    .isIn(values)
    .withMessage(`${field} debe ser uno de: ${values.join(', ')}`),

  /**
   * Search query validator with regex escape
   */
  searchQuery: () => query('search')
    .optional()
    .customSanitizer(val => val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),

  /**
   * String validator with trim
   * @param {string} field - Field name
   * @param {boolean} required - Whether the field is required (default: false)
   * @param {number} minLength - Minimum length (default: 1)
   * @param {number} maxLength - Maximum length (default: 255)
   */
  string: (field, required = false, minLength = 1, maxLength = 255) => {
    const validator = body(field).trim();
    
    if (required) {
      return validator
        .notEmpty()
        .withMessage(`${field} es requerido.`)
        .isLength({ min: minLength, max: maxLength })
        .withMessage(`${field} debe tener entre ${minLength} y ${maxLength} caracteres.`);
    } else {
      return validator
        .optional({ checkFalsy: true })
        .isLength({ min: minLength, max: maxLength })
        .withMessage(`${field} debe tener entre ${minLength} y ${maxLength} caracteres.`);
    }
  }
};

module.exports = { handleValidationErrors, validators };
