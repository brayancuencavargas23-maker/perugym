const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { clearDatabase, createAuthToken } = require('../helpers/setup');
jest.mock('../../config/storage', () => ({ saveImage: jest.fn(), deleteImage: jest.fn() }));
const { deleteImage } = require('../../config/storage');
const Cliente = require('../../models/Cliente');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');
const Asistencia = require('../../models/Asistencia');
const Usuario = require('../../models/Usuario');
const app = express();
app.use(express.json());
app.use('/api/clientes', require('../../routes/clientes'));
const actor = new mongoose.Types.ObjectId().toString();
const authorization = () => `Bearer ${createAuthToken({ id: actor, role: 'admin' })}`;
let db;
beforeAll(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
}, 60000);
beforeEach(async () => {
  await Usuario.create({ _id: actor, usuario: 'admin-prueba', email: 'admin@prueba.local', password: 'prueba', rol: 'admin' });
});
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); if (db) await db.stop(); });

test('la baja conserva cliente, fotografía, membresía, pago y asistencia; repetirla conserva la auditoría', async () => {
  const client = await Cliente.create({ nombre: 'Cliente histórico', foto_url: 'foto-original.jpg' });
  const mem = await Membresia.create({ cliente_id: client._id, plan_id: new mongoose.Types.ObjectId(),
    fecha_inicio: new Date('2026-10-01'), fecha_fin: new Date('2026-11-01'), monto_total: 100 });
  const payment = await Pago.create({ cliente_id: client._id, membresia_id: mem._id, monto: 100 });
  const attendance = await Asistencia.create({ cliente_id: client._id, membresia_id: mem._id });
  const res = await request(app).delete(`/api/clientes/${client._id}`).set('Authorization', authorization()).expect(200);
  expect(res.body.cliente.activo).toBe(false);
  const stored = await Cliente.findById(client._id);
  expect(stored.foto_url).toBe('foto-original.jpg');
  expect(stored.eliminado_por).toBe(actor);
  expect(stored.eliminado_en).toBeInstanceOf(Date);
  expect(deleteImage).not.toHaveBeenCalled();
  expect((await Membresia.findById(mem._id)).cliente_id.toString()).toBe(client.id);
  expect((await Pago.findById(payment._id)).membresia_id.toString()).toBe(mem.id);
  expect((await Asistencia.findById(attendance._id)).cliente_id.toString()).toBe(client.id);
  const again = await request(app).delete(`/api/clientes/${client._id}`).set('Authorization', authorization()).expect(200);
  expect(again.body.cliente.eliminado_en).toBe(stored.eliminado_en.toISOString());
  const inactive = await request(app).get('/api/clientes?activo=false').set('Authorization', authorization()).expect(200);
  expect(inactive.body.data.map(c => c._id)).toContain(client.id);
  const active = await request(app).get('/api/clientes?activo=true').set('Authorization', authorization()).expect(200);
  expect(active.body.data.map(c => c._id)).not.toContain(client.id);
});

test('editar no reactiva automáticamente ni borra datos; reactivar explícitamente conserva el ID', async () => {
  const client = await Cliente.create({ nombre: 'Ana', apellido_paterno: 'Perez', dni: '12345678', telefono: '999111222', notas: 'Historial' });
  await request(app).delete(`/api/clientes/${client._id}`).set('Authorization', authorization()).expect(200);
  await request(app).put(`/api/clientes/${client._id}`).set('Authorization', authorization()).send({ nombre: 'Ana María' }).expect(200);
  const inactive = await Cliente.findById(client._id);
  expect(inactive.activo).toBe(false);
  expect(inactive.dni).toBe('12345678');
  expect(inactive.telefono).toBe('999111222');
  expect(inactive.notas).toBe('Historial');
  const res = await request(app).put(`/api/clientes/${client._id}`).set('Authorization', authorization()).send({ activo: true }).expect(200);
  expect(res.body._id).toBe(client.id);
  expect(res.body.activo).toBe(true);
  expect(res.body.eliminado_en).toBeNull();
  expect(res.body.eliminado_por).toBeNull();
  expect(await Cliente.countDocuments()).toBe(1);
});

test('rechaza ID inválido, cliente inexistente, estado inválido y baja sin autenticación', async () => {
  await request(app).delete('/api/clientes/invalido').set('Authorization', authorization()).expect(400);
  const missing = new mongoose.Types.ObjectId();
  await request(app).delete(`/api/clientes/${missing}`).set('Authorization', authorization()).expect(404);
  await request(app).put(`/api/clientes/${missing}`).set('Authorization', authorization()).send({ activo: 'incorrecto' }).expect(400);
  await request(app).delete(`/api/clientes/${missing}`).expect(401);
});
