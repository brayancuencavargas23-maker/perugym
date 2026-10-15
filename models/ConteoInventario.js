const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  producto_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  nombre:         { type: String, required: true },
  stock_sistema:  { type: Number, required: true, min: 0 },
  stock_contado:  { type: Number, required: true, min: 0 },
  diferencia:     { type: Number, required: true },
}, { _id: false });

const conteoSchema = new mongoose.Schema({
  fecha:        { type: Date, default: Date.now },
  items:        { type: [itemSchema], validate: v => v.length > 0, required: true },
  ajustados:    { type: Number, default: 0 },
  sin_cambio:   { type: Number, default: 0 },
  notas:        { type: String, default: null, maxlength: 500 },
  usuario_id:   { type: String, required: true },
  responsable:  { type: String, required: true },
});

conteoSchema.index({ fecha: -1 });

module.exports = mongoose.model('ConteoInventario', conteoSchema);
