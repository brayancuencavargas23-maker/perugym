const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  estado: { type: String, enum: ['pendiente', 'contactado', 'resuelto'], default: 'pendiente' },
  responsable: { type: String, required: true },
  actualizado: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ReporteSeguimiento', schema);
