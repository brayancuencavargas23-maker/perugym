const mongoose = require('mongoose');

const membresiaSchema = new mongoose.Schema({
  cliente_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  plan_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  fecha_inicio: { type: Date, required: true },
  fecha_fin:    { type: Date, required: true },
  estado:       { type: String, enum: ['activo', 'vencido', 'cancelado', 'pendiente'], default: 'activo' },
}, { timestamps: { createdAt: 'created_at' } });

// Índices para consultas frecuentes
membresiaSchema.index({ cliente_id: 1, estado: 1 });       // buscar membresía activa de un cliente
membresiaSchema.index({ fecha_fin: 1, estado: 1 });         // autoVencer + vencen_pronto
membresiaSchema.index({ estado: 1 });

module.exports = mongoose.model('Membresia', membresiaSchema);
