const mongoose = require('mongoose');

// Cada compra conserva sus condiciones; los pagos antiguos pertenecen al periodo inicial.
module.exports = new mongoose.Schema({
  plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  plan_nombre: { type: String, required: true },
  fecha_inicio: { type: Date, required: true },
  fecha_fin: { type: Date, required: true },
  duracion_dias: { type: Number, required: true },
  precio_base: { type: Number, default: null },
  descuento: { type: Number, default: null },
  monto_total: { type: Number, required: true, min: 0 },
  habilitado: { type: Boolean, default: false },
  inicial: { type: Boolean, default: false },
  condiciones_asistencia: {
    limite_semanal: { type: Number, default: null },
    limite_diario: { type: Number, default: 1 },
  },
  usuario_id: { type: String, default: null },
  notas: { type: String, default: null },
  registrado_en: { type: Date, default: Date.now },
});
