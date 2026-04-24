const mongoose = require('mongoose');
const Caja = require('../models/Caja');

/**
 * Middleware: verifica que exista una caja abierta antes de registrar
 * ventas o pagos de membresía. Requiere caja_id en req.body.
 * Inyecta req.cajaActual con el documento de la caja.
 */
const requireCajaAbierta = async (req, res, next) => {
  const { caja_id } = req.body;

  if (!caja_id) {
    return res.status(400).json({
      error: 'Debe haber una caja abierta para registrar este movimiento. Abre la caja antes de continuar.',
    });
  }

  if (!mongoose.Types.ObjectId.isValid(caja_id)) {
    return res.status(400).json({ error: 'caja_id inválido.' });
  }

  try {
    const caja = await Caja.findOne({ _id: caja_id, estado: 'abierta' });
    if (!caja) {
      return res.status(400).json({
        error: 'La caja indicada no existe o ya fue cerrada. Abre una nueva caja para continuar.',
      });
    }
    req.cajaActual = caja;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Error al verificar el estado de la caja.' });
  }
};

module.exports = { requireCajaAbierta };
