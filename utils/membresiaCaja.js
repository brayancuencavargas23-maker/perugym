const Caja = require('../models/Caja');
const { BusinessError } = require('../middleware/errors/ErrorTypes');

// Escribir la caja dentro de la sesión hace competir el cobro con su cierre.
module.exports = async (cajaId, session) => {
  const result = await Caja.updateOne({ _id: cajaId, estado: 'abierta' },
    { $inc: { __v: 1 } }, { session });
  if (!result.modifiedCount) throw new BusinessError('La caja no está abierta.');
};
