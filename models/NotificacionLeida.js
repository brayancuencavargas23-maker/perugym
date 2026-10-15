const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  usuario_id: { type: String, required: true },
  clave: { type: String, required: true },
  leida_en: { type: Date, default: Date.now },
});
schema.index({ usuario_id: 1, clave: 1 }, { unique: true });

module.exports = mongoose.model('NotificacionLeida', schema);
