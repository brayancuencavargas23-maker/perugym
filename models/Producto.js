const mongoose = require('mongoose');

const productoSchema = new mongoose.Schema({
  nombre:       { type: String, required: true },
  categoria:    { type: String, default: null },
  precio_venta: { type: Number, required: true },
  stock:        { type: Number, default: 0 },
  stock_minimo: { type: Number, default: 5, min: 0, validate: Number.isSafeInteger },
  costo:        { type: Number, default: 0, min: 0 },
  codigo_barras:{ type: String, default: null, trim: true, maxlength: 30 },
  descripcion:  { type: String, default: null },
  foto_url:     { type: String, default: null },
  activo:       { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at' } });

productoSchema.index(
  { codigo_barras: 1 },
  { unique: true, partialFilterExpression: { codigo_barras: { $type: 'string' } } }
);

module.exports = mongoose.model('Producto', productoSchema);
