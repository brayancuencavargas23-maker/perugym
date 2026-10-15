const mongoose = require('mongoose');

const membresiaSchema = new mongoose.Schema({
  cliente_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  plan_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  fecha_inicio: { type: Date, required: true },
  fecha_fin:    { type: Date, required: true },
  estado:       { type: String, enum: ['activo', 'vencido', 'cancelado', 'pendiente'], default: 'activo' },
  monto_total:  { type: Number, default: null },
  periodos: { type: [require('./PeriodoMembresia')], default: undefined },
  precio_base: { type: Number, default: null },
  plan_nombre: { type: String, default: null },
  condiciones_asistencia: { type: new mongoose.Schema({
    limite_semanal: { type: Number, default: null },
    limite_diario: { type: Number, default: 1 },
  }, { _id: false }), default: undefined },
}, { timestamps: { createdAt: 'created_at' } });

// Índices para consultas frecuentes
membresiaSchema.index({ cliente_id: 1, estado: 1 });       // buscar membresía activa de un cliente
membresiaSchema.index({ fecha_fin: 1, estado: 1 });         // autoVencer + vencen_pronto
membresiaSchema.index({ estado: 1 });

module.exports = mongoose.model('Membresia', membresiaSchema);
