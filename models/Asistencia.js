const mongoose = require('mongoose');

const asistenciaSchema = new mongoose.Schema({
  cliente_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  membresia_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Membresia' },
  periodo_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  dia_local: { type: String },
  semana_local: { type: String },
  cupo_semanal: { type: Number },
  entrada:    { type: Date, default: Date.now },
  salida:     { type: Date, default: null },
  fecha:      { type: Date, default: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }},
});

asistenciaSchema.index({ entrada: -1 });
asistenciaSchema.index({ cliente_id: 1, entrada: -1 });
// Índices parciales: preservan el historial previo y protegen ingresos simultáneos.
asistenciaSchema.index({ cliente_id: 1, dia_local: 1 }, {
  unique: true, partialFilterExpression: { dia_local: { $type: 'string' } },
});
asistenciaSchema.index({ cliente_id: 1, semana_local: 1, cupo_semanal: 1 }, {
  unique: true, partialFilterExpression: { cupo_semanal: { $type: 'number' } },
});

module.exports = mongoose.model('Asistencia', asistenciaSchema);
