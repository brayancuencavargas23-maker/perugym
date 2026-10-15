const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { clearDatabase, createAuthToken } = require('../helpers/setup');
const Solicitud = require('../../models/Solicitud');
const Plan = require('../../models/Plan');
const Producto = require('../../models/Producto');
const Leida = require('../../models/NotificacionLeida');
const Notificaciones = require('../../services/NotificacionesService');

const app = express();
app.use(express.json());
app.use('/api/dashboard', require('../../routes/dashboard'));
const auth = `Bearer ${createAuthToken({ id: 'dev', role: 'admin' })}`;
let db;
beforeAll(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Leida.init();
}, 60000);
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); if (db) await db.stop(); });

test('la campanita permite leer solicitudes junto con otras alertas y conserva la lectura', async () => {
  const plan = await Plan.create({ nombre: 'Mensual', precio: 100, duracion_dias: 30 });
  const solicitud = await Solicitud.create({ nombre: 'Ana Pérez', telefono: '999888777', plan_id: plan._id });
  await Producto.create({ nombre: 'Agua', stock: 0, precio_venta: 3 });
  const first = await request(app).get('/api/dashboard/notifications').set('Authorization', auth).expect(200);
  const claves = first.body.items.map(n => n.clave);
  expect(claves).toContain(`solicitud:${solicitud._id}`);
  expect(first.body.no_leidas).toBe(2);

  const read = await request(app).post('/api/dashboard/notifications/read').set('Authorization', auth)
    .send({ claves, usuario_id: 'otro' }).expect(200);
  expect(read.body).toMatchObject({ total: 2, no_leidas: 0 });
  const next = await request(app).get('/api/dashboard/notifications').set('Authorization', auth).expect(200);
  expect(next.body.no_leidas).toBe(0);
  expect((await Notificaciones.listar('otro')).no_leidas).toBe(2);
  expect(await Solicitud.countDocuments({ estado: 'pendiente' })).toBe(1);

  await request(app).post('/api/dashboard/notifications/read').set('Authorization', auth).send({ claves }).expect(200);
  expect(await Leida.countDocuments()).toBe(2);
  await Solicitud.create({ nombre: 'Luis Rojas', telefono: '988777666', plan_id: plan._id });
  expect((await Notificaciones.listar('dev')).no_leidas).toBe(1);
});

test('la lectura sigue exigiendo autenticación y formatos de clave válidos', async () => {
  await request(app).post('/api/dashboard/notifications/read').send({ claves: [] }).expect(401);
  for (const claves of [['solicitud:invalida'], ['solicitud:' + 'a'.repeat(25)], ['otra:' + 'a'.repeat(24)], [123], 'invalida', Array(501).fill('a'.repeat(64))]) {
    await request(app).post('/api/dashboard/notifications/read').set('Authorization', auth).send({ claves }).expect(400);
  }
  expect(await Leida.countDocuments()).toBe(0);
});
