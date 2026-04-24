const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gym_db';

const connectDB = async () => {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB conectado:', mongoose.connection.host);
};

const initDB = async () => {
  await connectDB();

  // Crear usuario admin por defecto si no existe
  const Usuario = require('../models/Usuario');
  const existing = await Usuario.findOne({ email: 'admin@gym.com' });
  if (!existing) {
    const hash = await bcrypt.hash('admin123', 10);
    await Usuario.create({
      usuario: 'admin',
      email: 'admin@gym.com',
      password: hash,
      rol: 'admin',
    });
    console.log('Usuario admin creado: usuario=admin / admin123');
  }

  // Crear planes de ejemplo si no existen
  const Plan = require('../models/Plan');
  const count = await Plan.countDocuments();
  if (count === 0) {
    await Plan.insertMany([
      {
        nombre: 'Básico',
        precio: 99,
        duracion_dias: 30,
        descripcion: 'Ideal para empezar',
        caracteristicas: ['Acceso a sala de musculación', 'Clases grupales básicas', '1 evaluación física mensual'],
        mostrar_landing: true,
        destacado: false,
      },
      {
        nombre: 'Pro',
        precio: 149,
        duracion_dias: 30,
        descripcion: 'Para resultados reales',
        caracteristicas: ['Acceso ilimitado a todas las áreas', 'Clases grupales ilimitadas', 'Evaluaciones físicas mensuales'],
        mostrar_landing: true,
        destacado: true,
      },
      {
        nombre: 'Premium',
        precio: 199,
        duracion_dias: 30,
        descripcion: 'Máximo rendimiento',
        caracteristicas: ['Todo en plan PRO', 'Nutricionista incluido', 'Acceso a zonas exclusivas'],
        mostrar_landing: true,
        destacado: false,
      },
    ]);
    console.log('Planes de ejemplo creados');
  }

  console.log('✅ Base de datos inicializada correctamente');
};

module.exports = { initDB };
