const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
  nombre:           { type: String, required: true },  // Nombres (first_name)
  apellido_paterno: { type: String, default: null },   // first_last_name
  apellido_materno: { type: String, default: null },   // second_last_name
  dni:              { type: String, sparse: true, default: null },
  email:            { type: String, default: null },
  telefono:         { type: String, default: null },
  foto_url:         { type: String, default: null },
  notas:            { type: String, default: null },
  activo:           { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at' } });

// Índices para búsquedas frecuentes
clienteSchema.index({ nombre: 'text', apellido_paterno: 'text', apellido_materno: 'text', dni: 'text', email: 'text' });
clienteSchema.index({ activo: 1 });
clienteSchema.index({ dni: 1 }, { sparse: true });

module.exports = mongoose.model('Cliente', clienteSchema);
