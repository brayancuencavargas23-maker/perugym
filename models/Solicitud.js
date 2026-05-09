const mongoose = require('mongoose');

const solicitudSchema = new mongoose.Schema({
  nombre:           { type: String, required: true, trim: true },
  apellido_paterno: { type: String, default: null, trim: true },
  apellido_materno: { type: String, default: null, trim: true },
  dni:              { type: String, default: null, trim: true },
  telefono:         { type: String, required: true, trim: true },
  email:            { type: String, default: null, trim: true },
  plan_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  estado:           { type: String, enum: ['pendiente', 'contactado', 'convertido', 'descartado'], default: 'pendiente' },
  notas:            { type: String, default: null },
  atendido_por:     { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
  cliente_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Índices para consultas frecuentes
solicitudSchema.index({ estado: 1, created_at: -1 });
solicitudSchema.index({ plan_id: 1 });
solicitudSchema.index({ created_at: -1 });

module.exports = mongoose.model('Solicitud', solicitudSchema);
