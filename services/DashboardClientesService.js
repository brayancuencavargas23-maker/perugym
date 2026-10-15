const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');

async function resumen(now = new Date()) {
  const ids = await Membresia.distinct('cliente_id', {
    estado: 'activo', fecha_inicio: { $lte: now }, fecha_fin: { $gte: now },
  });
  const registrados = { eliminado_en: null };
  const [clientesActivos, clientesRegistrados] = await Promise.all([
    Cliente.countDocuments({ ...registrados, activo: true, _id: { $in: ids } }),
    Cliente.countDocuments(registrados),
  ]);
  return { clientesActivos, clientesRegistrados };
}

module.exports = { resumen };
