const mongoose = require('mongoose');
const Producto = require('../../models/Producto');
const Cliente = require('../../models/Cliente');
const Caja = require('../../models/Caja');
const Plan = require('../../models/Plan');
const Usuario = require('../../models/Usuario');

// Simple random generators to avoid ESM issues with faker
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomString = (length) => Math.random().toString(36).substring(2, 2 + length);
const randomName = () => ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Carmen'][randomInt(0, 5)];
const randomLastName = () => ['García', 'Rodríguez', 'López', 'Martínez', 'González', 'Pérez'][randomInt(0, 5)];
const randomProductName = () => ['Proteína', 'Creatina', 'BCAA', 'Pre-Workout', 'Glutamina', 'Vitaminas'][randomInt(0, 5)];
const randomPlanName = () => ['Plan Básico', 'Plan Premium', 'Plan VIP', 'Plan Mensual', 'Plan Trimestral', 'Plan Anual'][randomInt(0, 5)];
const randomEmail = () => `user${randomString(6)}@test.com`;

/**
 * Create a test product
 * @param {Object} overrides - Fields to override
 * @returns {Promise<Producto>}
 */
async function createProducto(overrides = {}) {
  return Producto.create({
    nombre: randomProductName() + ' ' + randomString(4),
    precio_venta: randomInt(10, 200),
    stock: randomInt(0, 100),
    activo: true,
    ...overrides
  });
}

/**
 * Create a test client
 * @param {Object} overrides - Fields to override
 * @returns {Promise<Cliente>}
 */
async function createCliente(overrides = {}) {
  return Cliente.create({
    nombre: randomName(),
    apellido_paterno: randomLastName(),
    apellido_materno: randomLastName(),
    telefono: `9${randomInt(10000000, 99999999)}`,
    dni: `${randomInt(10000000, 99999999)}`,
    ...overrides
  });
}

/**
 * Create a test cash register
 * @param {Object} overrides - Fields to override
 * @returns {Promise<Caja>}
 */
async function createCaja(overrides = {}) {
  return Caja.create({
    usuario_id: new mongoose.Types.ObjectId(),
    estado: 'abierta',
    monto_inicial: 0,
    apertura: new Date(),
    ...overrides
  });
}

/**
 * Create a test plan
 * @param {Object} overrides - Fields to override
 * @returns {Promise<Plan>}
 */
async function createPlan(overrides = {}) {
  return Plan.create({
    nombre: randomPlanName() + ' ' + randomString(4),
    precio: randomInt(50, 300),
    duracion_dias: 30,
    activo: true,
    mostrar_landing: true,
    ...overrides
  });
}

/**
 * Create a test user
 * @param {Object} overrides - Fields to override
 * @returns {Promise<Usuario>}
 */
async function createUsuario(overrides = {}) {
  const randomStr = randomString(6);
  return Usuario.create({
    usuario: `user_${randomStr}`,
    email: randomEmail(),
    password: '$2b$10$abcdefghijklmnopqrstuvwxyz123456', // hashed password
    rol: 'recepcionista',
    activo: true,
    ...overrides
  });
}

module.exports = {
  createProducto,
  createCliente,
  createCaja,
  createPlan,
  createUsuario
};
