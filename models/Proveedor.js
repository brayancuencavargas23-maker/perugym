const mongoose = require('mongoose');

const proveedorSchema = new mongoose.Schema({
  nombre:    { type: String, required: true, trim: true, maxlength: 120 },
  contacto:  { type: String, default: null, trim: true, maxlength: 120 },
  telefono:  { type: String, default: null, trim: true, maxlength: 30 },
  email:     { type: String, default: null, trim: true, maxlength: 120 },
  direccion: { type: String, default: null, trim: true, maxlength: 200 },
  notas:     { type: String, default: null, trim: true, maxlength: 500 },
  activo:    { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at' } });

proveedorSchema.index({ nombre: 1 });

module.exports = mongoose.model('Proveedor', proveedorSchema);
