const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  producto_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  nombre:      { type: String, required: true },
  cantidad:    { type: Number, required: true, min: 1 },
  costo_unit:  { type: Number, required: true, min: 0 },
  subtotal:    { type: Number, required: true, min: 0 },
  fecha_vencimiento: { type: Date, default: null },
  numero_lote:       { type: String, default: null, maxlength: 40 },
}, { _id: false });

const compraSchema = new mongoose.Schema({
  proveedor_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Proveedor', default: null },
  proveedor_nombre:  { type: String, default: null },
  fecha:             { type: Date, default: Date.now },
  items:             { type: [itemSchema], validate: v => v.length > 0, required: true },
  costo_total:       { type: Number, required: true, min: 0 },
  notas:             { type: String, default: null, maxlength: 500 },
  usuario_id:        { type: String, required: true },
  responsable:       { type: String, required: true },
  anulada:           { type: Boolean, default: false },
});

compraSchema.index({ fecha: -1 });
compraSchema.index({ proveedor_id: 1, fecha: -1 });

module.exports = mongoose.model('Compra', compraSchema);
