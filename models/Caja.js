const mongoose = require('mongoose');

const cajaSchema = new mongoose.Schema({
  usuario_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  apertura:       { type: Date, default: Date.now },
  cierre:         { type: Date, default: null },
  monto_inicial:  { type: Number, default: 0 },
  monto_final:    { type: Number, default: null },
  total_ingresos: { type: Number, default: 0 },
  estado:         { type: String, enum: ['abierta', 'cerrada'], default: 'abierta' },
  notas:          { type: String, default: null },
});

module.exports = mongoose.model('Caja', cajaSchema);
