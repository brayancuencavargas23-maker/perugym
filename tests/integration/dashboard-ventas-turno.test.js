const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { clearDatabase, createAuthToken } = require('../helpers/setup');
const Usuario = require('../../models/Usuario');
const Caja = require('../../models/Caja');
const Pago = require('../../models/Pago');
const Venta = require('../../models/Venta');
const MovimientoCaja = require('../../models/MovimientoCaja');

const app = express();
app.use(express.json());
app.use('/api/dashboard', require('../../routes/dashboard'));
const auth = `Bearer ${createAuthToken({ id: 'dev', role: 'admin' })}`;
let db;
beforeAll(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
}, 60000);
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); if (db) await db.stop(); });

const getStats = async () => (await request(app).get('/api/dashboard').set('Authorization', auth).expect(200)).body.stats;

test('la tarjeta suma todo el turno (membresías, abonos, productos, rutinas) sin importar el método de pago', async () => {
  const cajero = await Usuario.create({ usuario: 'ana', email: 'ana@p.gym', password: 'x', rol: 'recepcionista' });
  const caja = await Caja.create({ usuario_id: cajero._id, monto_inicial: 50 });
  const otraCaja = await Caja.create({ usuario_id: cajero._id, estado: 'cerrada' });
  const mov = (extra) => ({ caja_id: caja._id, usuario_id: cajero._id, concepto: 'x', ...extra });

  await Pago.create({ caja_id: caja._id, monto: 100, estado: 'pagado' });                        // cobro membresía (efectivo)
  await Pago.create({ caja_id: caja._id, monto: 50, estado: 'pagado', metodo_pago: 'yape' });    // pago/abono en yape
  await Pago.create({ caja_id: caja._id, monto: 30, estado: 'pendiente' });                      // pendiente: no cuenta
  await Pago.create({ caja_id: otraCaja._id, monto: 999, estado: 'pagado' });                    // otra caja: no cuenta
  await Venta.create({ caja_id: caja._id, items: [{ producto_id: new mongoose.Types.ObjectId(), cantidad: 2, precio_unit: 10, subtotal: 20 }] });
  await Venta.create({ caja_id: caja._id, anulada: true, items: [{ producto_id: new mongoose.Types.ObjectId(), cantidad: 1, precio_unit: 7, subtotal: 7 }] }); // anulada: no cuenta
  await MovimientoCaja.create(mov({ tipo: 'ingreso', monto: 15, es_rutina: true, metodo_pago: 'efectivo' }));
  await MovimientoCaja.create(mov({ tipo: 'ingreso', monto: 25, es_rutina: false, metodo_pago: 'yape' }));
  await MovimientoCaja.create(mov({ tipo: 'egreso', monto: 10, metodo_pago: 'efectivo' }));       // egreso: no cuenta

  const stats = await getStats();
  // 100 + 50 pagos, 20 productos, 15 rutina + 25 ingreso manual
  expect(stats.ventasTurno).toEqual({ total: 210, cajero: 'ana', abierta: true });
});

test('al cerrar la caja el contador se reinicia a cero', async () => {
  const cajero = await Usuario.create({ usuario: 'luis', email: 'luis@p.gym', password: 'x', rol: 'recepcionista' });
  const caja = await Caja.create({ usuario_id: cajero._id });
  await Pago.create({ caja_id: caja._id, monto: 80, estado: 'pagado' });
  expect((await getStats()).ventasTurno).toMatchObject({ total: 80, cajero: 'luis', abierta: true });

  await Caja.findByIdAndUpdate(caja._id, { estado: 'cerrada', cierre: new Date(), monto_final: 130 });
  expect((await getStats()).ventasTurno).toEqual({ total: 0, cajero: null, abierta: false });
});

test('sin caja abierta la tarjeta reporta turno cerrado', async () => {
  const stats = await getStats();
  expect(stats.ventasTurno).toEqual({ total: 0, cajero: null, abierta: false });
  expect(stats.ingresosDelMes).toBe(0);
});

test('clientes: solo activos con membresía vigente, sin duplicar; total incluye vencidos e inactivos no eliminados', async () => {
  const Cliente = require('../../models/Cliente');
  const Membresia = require('../../models/Membresia');
  const Plan = require('../../models/Plan');
  const plan = await Plan.create({ nombre: 'Mensual', precio: 100, duracion_dias: 30 });
  const nombres = ['Vigente', 'Vencido', 'Futuro', 'Cancelado', 'Pendiente', 'Sin membresía', 'Inactivo', 'Eliminado'];
  const clientes = await Cliente.create(nombres.map((nombre, i) => ({ nombre, activo: i !== 6, eliminado_en: i === 7 ? new Date() : null })));
  const now = Date.now();
  const day = 86400000;
  const mem = (i, extra = {}) => ({ cliente_id: clientes[i]._id, plan_id: plan._id,
    estado: 'activo', fecha_inicio: new Date(now - day), fecha_fin: new Date(now + day), ...extra });
  await Membresia.create([
    mem(0), mem(0), mem(1, { fecha_fin: new Date(now - 1) }),
    mem(2, { fecha_inicio: new Date(now + day), fecha_fin: new Date(now + 2 * day) }),
    mem(3, { estado: 'cancelado' }), mem(4, { estado: 'pendiente' }), mem(6), mem(7),
  ]);
  expect(await getStats()).toMatchObject({ clientesActivos: 1, clientesRegistrados: 7 });
});
