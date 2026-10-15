const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  nombre:          { type: String, required: true },
  precio:          { type: Number, required: true },
  duracion_dias:   { type: Number, required: true },
  limite_semanal:  { type: Number, default: null, min: 1, max: 7, validate: { validator: v => v == null || Number.isInteger(v), message: 'El límite debe ser entero.' } },
  descripcion:     { type: String },
  caracteristicas: { type: [String], default: [] },
  mostrar_landing: { type: Boolean, default: false },
  destacado:       { type: Boolean, default: false },
  activo:          { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at' } });

module.exports = mongoose.model('Plan', planSchema);
