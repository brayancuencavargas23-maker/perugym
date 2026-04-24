const mongoose = require('mongoose');

const asistenciaSchema = new mongoose.Schema({
  cliente_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  entrada:    { type: Date, default: Date.now },
  salida:     { type: Date, default: null },
  fecha:      { type: Date, default: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }},
});

module.exports = mongoose.model('Asistencia', asistenciaSchema);
