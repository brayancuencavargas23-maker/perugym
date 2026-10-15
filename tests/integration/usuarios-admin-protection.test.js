const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { clearDatabase, createAuthToken } = require('../helpers/setup');
const Usuario = require('../../models/Usuario');

const app = express();
app.use(express.json());
app.use('/api/auth', require('../../routes/auth'));

const token = user => `Bearer ${createAuthToken({ id: user._id.toString(), role: 'admin' })}`;
let db;
beforeAll(async () => {
  process.env.DEV_USERNAME = 'devoficial';
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
}, 60000);
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); if (db) await db.stop(); });

const crear = (usuario, rol = 'recepcionista', activo = true) =>
  Usuario.create({ usuario, email: `${usuario}@peru.gym`, password: 'x', rol, activo });

test('una cuenta admin no se puede eliminar, ni siquiera por otro admin', async () => {
  const admin = await crear('ana', 'admin');
  const actor = await crear('luis', 'admin');
  const res = await request(app).delete(`/api/auth/users/${admin._id}`).set('Authorization', token(actor)).expect(403);
  expect(res.body.error).toMatch(/administradoras/i);
  expect(await Usuario.countDocuments()).toBe(2);
});

test('nadie puede eliminar su propia cuenta', async () => {
  const admin = await crear('ana', 'admin');
  const res = await request(app).delete(`/api/auth/users/${admin._id}`).set('Authorization', token(admin)).expect(403);
  expect(res.body.error).toMatch(/propia cuenta/i);
  expect(await Usuario.countDocuments({ usuario: 'ana' })).toBe(1);
});

test('una cuenta recepcionista sí se elimina y el id inválido o desconocido se rechaza', async () => {
  const admin = await crear('ana', 'admin');
  const op = await crear('jorge');
  await request(app).delete(`/api/auth/users/${op._id}`).set('Authorization', token(admin)).expect(200);
  expect(await Usuario.countDocuments({ usuario: 'jorge' })).toBe(0);
  await request(app).delete('/api/auth/users/no-es-id').set('Authorization', token(admin)).expect(400);
  await request(app).delete(`/api/auth/users/${new mongoose.Types.ObjectId()}`).set('Authorization', token(admin)).expect(404);
  await request(app).delete(`/api/auth/users/${op._id}`).expect(401);
});

test('el usuario desarrollador sigue intocable', async () => {
  const admin = await crear('ana', 'admin');
  const dev = await crear('devoficial', 'admin');
  const res = await request(app).delete(`/api/auth/users/${dev._id}`).set('Authorization', token(admin)).expect(403);
  expect(res.body.error).toMatch(/no puede ser eliminado/i);
});

test('no se puede degradar al único admin activo', async () => {
  const admin = await crear('ana', 'admin');
  const res = await request(app).put(`/api/auth/users/${admin._id}`)
    .set('Authorization', token(admin)).send({ role: 'recepcionista' }).expect(403);
  expect(res.body.error).toMatch(/al menos un administrador activo/i);
  expect((await Usuario.findById(admin._id)).rol).toBe('admin');

  // Un segundo admin que está inactivo no cuenta como respaldo
  await crear('luis', 'admin', false);
  await request(app).put(`/api/auth/users/${admin._id}`)
    .set('Authorization', token(admin)).send({ active: false }).expect(403);
  expect((await Usuario.findById(admin._id)).activo).toBe(true);
});

test('no se puede desactivar al único admin activo', async () => {
  const admin = await crear('ana', 'admin');
  await request(app).put(`/api/auth/users/${admin._id}`)
    .set('Authorization', token(admin)).send({ active: false }).expect(403);
  expect((await Usuario.findById(admin._id)).activo).toBe(true);
});

test('con otro admin activo sí se permite degradar y desactivar', async () => {
  const ana  = await crear('ana', 'admin');
  const luis = await crear('luis', 'admin');
  const res = await request(app).put(`/api/auth/users/${ana._id}`)
    .set('Authorization', token(luis)).send({ name: 'ana', email: 'ana@peru.gym', role: 'recepcionista', active: true }).expect(200);
  expect(res.body.role).toBe('recepcionista');
  const sofia = await crear('sofia', 'admin');
  await request(app).put(`/api/auth/users/${sofia._id}`)
    .set('Authorization', token(luis)).send({ active: false }).expect(200);
  expect((await Usuario.findById(sofia._id)).activo).toBe(false);
});

test('la edición parcial no borra campos y el rol inválido se rechaza', async () => {
  const admin = await crear('ana', 'admin');
  await crear('luis', 'admin');
  const op = await crear('jorge');
  await request(app).put(`/api/auth/users/${op._id}`)
    .set('Authorization', token(admin)).send({ role: 'recepcionista' }).expect(200);
  const trasEdicion = await Usuario.findById(op._id).lean();
  expect(trasEdicion.email).toBe('jorge@peru.gym');
  expect(trasEdicion.usuario).toBe('jorge');
  await request(app).put(`/api/auth/users/${op._id}`)
    .set('Authorization', token(admin)).send({ role: 'super' }).expect(400);
  const res = await request(app).put(`/api/auth/users/${op._id}`)
    .set('Authorization', token(admin)).send({ role: 'admin', active: true }).expect(200);
  expect(res.body.role).toBe('admin');
  expect(await Usuario.countDocuments({ rol: 'admin', activo: true })).toBe(3);
});

test('solo los admins gestionan usuarios', async () => {
  const op = await crear('jorge', 'recepcionista');
  const res = await request(app).delete(`/api/auth/users/${op._id}`).set('Authorization', token(op)).expect(403);
  expect(res.body.error).toMatch(/Acceso denegado/i);
  await request(app).get('/api/auth/users').set('Authorization', token(op)).expect(403);
});
