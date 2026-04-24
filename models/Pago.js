const mongoose = require('mongoose');

const pagoSchema = new mongoose.Schema({
  cliente_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
  membresia_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Membresia' },
  caja_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Caja', default: null },
  monto:        { type: Number, required: true },
  metodo_pago:  { type: String, enum: ['efectivo', 'tarjeta', 'transferencia'], default: 'efectivo' },
  estado:       { type: String, enum: ['pagado', 'pendiente'], default: 'pagado' },
  fecha_pago:   { type: Date, default: Date.now },
  notas:        { type: String, default: null },
});

// Índices para reportes y filtros frecuentes
pagoSchema.index({ caja_id: 1, estado: 1 });
pagoSchema.index({ cliente_id: 1 });
pagoSchema.index({ fecha_pago: -1 });
pagoSchema.index({ estado: 1 });

module.exports = mongoose.model('Pago', pagoSchema);
