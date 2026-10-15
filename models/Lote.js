const mongoose = require('mongoose');

const loteSchema = new mongoose.Schema({
  producto_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  numero_lote:       { type: String, default: null, trim: true, maxlength: 40 },
  cantidad:          { type: Number, required: true, min: 1 },
  fecha_vencimiento: { type: Date, required: true },
  compra_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Compra', default: null },
  proveedor_nombre:  { type: String, default: null },
  usuario_id:        { type: String, default: null },
  responsable:       { type: String, default: null },
  creado_en:         { type: Date, default: Date.now },
});

loteSchema.index({ producto_id: 1, fecha_vencimiento: 1 });
loteSchema.index({ fecha_vencimiento: 1 });

module.exports = mongoose.model('Lote', loteSchema);
