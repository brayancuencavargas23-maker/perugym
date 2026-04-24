const mongoose = require('mongoose');

const ventaDetalleSchema = new mongoose.Schema({
  producto_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  cantidad:    { type: Number, required: true, default: 1 },
  precio_unit: { type: Number, required: true },
  subtotal:    { type: Number, required: true },
});

const ventaSchema = new mongoose.Schema({
  caja_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Caja', required: true },
  cliente_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', default: null },
  fecha_venta: { type: Date, default: Date.now },
  anulada:     { type: Boolean, default: false },
  anulada_at:  { type: Date, default: null },
  items:       [ventaDetalleSchema],
});

ventaSchema.index({ caja_id: 1 });
ventaSchema.index({ fecha_venta: -1 });
ventaSchema.index({ anulada: 1 });

module.exports = mongoose.model('Venta', ventaSchema);
