const mongoose = require('mongoose');

const productoSchema = new mongoose.Schema({
  nombre:       { type: String, required: true },
  categoria:    { type: String, default: null },
  precio_venta: { type: Number, required: true },
  stock:        { type: Number, default: 0 },
  descripcion:  { type: String, default: null },
  foto_url:     { type: String, default: null },
  activo:       { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at' } });

module.exports = mongoose.model('Producto', productoSchema);
