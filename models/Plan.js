const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  nombre:          { type: String, required: true },
  precio:          { type: Number, required: true },
  duracion_dias:   { type: Number, required: true },
  descripcion:     { type: String },
  caracteristicas: { type: [String], default: [] },
  mostrar_landing: { type: Boolean, default: false },
  destacado:       { type: Boolean, default: false },
  activo:          { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at' } });

module.exports = mongoose.model('Plan', planSchema);
