const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
  nombre:   { type: String, required: true },
  dni:      { type: String, sparse: true, default: null },
  email:    { type: String, default: null },
  telefono: { type: String, default: null },
  foto_url: { type: String, default: null },
  notas:    { type: String, default: null },
  activo:   { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at' } });

// Índices para búsquedas frecuentes
clienteSchema.index({ nombre: 'text', dni: 'text', email: 'text' });
clienteSchema.index({ activo: 1 });
clienteSchema.index({ dni: 1 }, { sparse: true });

module.exports = mongoose.model('Cliente', clienteSchema);
