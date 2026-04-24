// Scheduled function: corre diariamente a las 2am UTC
// Marca como 'vencido' todas las membresías activas cuya fecha_fin ya pasó
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gym_db';

exports.handler = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGO_URI);
    }

    const Membresia = require('../../models/Membresia');
    const result = await Membresia.updateMany(
      { fecha_fin: { $lt: new Date() }, estado: 'activo' },
      { $set: { estado: 'vencido' } }
    );

    console.log(`[vencer-membresias] ${result.modifiedCount} membresías marcadas como vencidas`);
    return { statusCode: 200, body: JSON.stringify({ actualizadas: result.modifiedCount }) };
  } catch (err) {
    console.error('[vencer-membresias] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
