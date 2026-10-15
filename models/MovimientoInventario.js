const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  producto_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  tipo: { type: String, enum: ['inicial', 'entrada', 'ajuste', 'venta', 'anulacion'], required: true },
  cantidad: { type: Number, required: true },
  stock_anterior: { type: Number, required: true },
  stock_nuevo: { type: Number, required: true },
  motivo: { type: String, required: true },
  usuario_id: { type: String, required: true },
  responsable: { type: String, required: true },
  venta_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Venta', default: null },
  compra_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Compra', default: null },
  conteo_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ConteoInventario', default: null },
  fecha: { type: Date, default: Date.now }
});
schema.index({ producto_id: 1, fecha: -1 });
module.exports = mongoose.model('MovimientoInventario', schema);
