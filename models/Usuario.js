const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  usuario:  { type: String, required: true, unique: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rol:      { type: String, enum: ['admin', 'recepcionista'], default: 'recepcionista' }, // entrenador unificado con recepcionista
  activo:   { type: Boolean, default: true },
  permisos: { type: [String], default: [] },
}, { timestamps: { createdAt: 'created_at' } });

module.exports = mongoose.model('Usuario', usuarioSchema);
