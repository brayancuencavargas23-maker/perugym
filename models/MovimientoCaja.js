const mongoose = require('mongoose');

const movimientoCajaSchema = new mongoose.Schema({
  caja_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Caja', required: true },
  usuario_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  tipo:       { type: String, enum: ['ingreso', 'egreso'], required: true },
  monto:      { type: Number, required: true, min: 0.01 },
  concepto:   { type: String, required: true, trim: true },
  fecha:      { type: Date, default: Date.now },
});

module.exports = mongoose.model('MovimientoCaja', movimientoCajaSchema);
