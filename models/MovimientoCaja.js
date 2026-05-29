const mongoose = require('mongoose');

const movimientoCajaSchema = new mongoose.Schema({
  caja_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Caja', required: true },
  usuario_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  tipo:         { type: String, enum: ['ingreso', 'egreso'], required: true },
  monto:        { type: Number, required: true, min: 0.01 },
  concepto:     { type: String, required: true, trim: true },
  metodo_pago:  { type: String, enum: ['efectivo', 'yape', 'plin', 'transferencia'], default: 'efectivo' },
  es_rutina:    { type: Boolean, default: false },   // true = ingreso rápido de cliente por rutina
  fecha:        { type: Date, default: Date.now },
});

module.exports = mongoose.model('MovimientoCaja', movimientoCajaSchema);
