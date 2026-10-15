const express = require('express');
const request = require('supertest');
const { setupTestDB, teardownTestDB, clearDatabase, createAuthToken } = require('../helpers/setup');
const Usuario = require('../../models/Usuario');
const Producto = require('../../models/Producto');
const Compra = require('../../models/Compra');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../../routes/auth'));
app.use('/api/compras', require('../../routes/compras'));
app.use('/api/proveedores', require('../../routes/proveedores'));
app.use('/api/reports', require('../../routes/reports'));
const auth = user => `Bearer ${createAuthToken({ id: String(user._id), role: user.rol })}`;
let admin, operador;
beforeAll(setupTestDB, 60000);
afterAll(teardownTestDB);
beforeEach(async () => {
  admin = await Usuario.create({ usuario: 'Admin', email: 'admin@test.pe', password: 'x', rol: 'admin' });
  operador = await Usuario.create({ usuario: 'Operador', email: 'op@test.pe', password: 'x', rol: 'recepcionista' });
});
afterEach(clearDatabase);

test('asignar Compras habilita API, proveedores y exportación; revocarlo afecta el mismo JWT', async () => {
  const token = auth(operador);
  await request(app).get('/api/compras').set('Authorization', token).expect(403);
  await request(app).post('/api/proveedores').set('Authorization', token).send({ nombre: 'Distribuidora' }).expect(403);
  await request(app).get('/api/reports/compras/excel').set('Authorization', token).expect(403);
  const permisosURL = `/api/auth/users/${operador._id}/permisos`;
  await request(app).put(permisosURL).set('Authorization', auth(admin)).send({ permisos: ['compras'] }).expect(200);
  expect((await Usuario.findById(operador._id)).permisos).toEqual(['compras']);
  await request(app).get('/api/compras').set('Authorization', token).expect(200);
  await request(app).get('/api/compras/resumen').set('Authorization', token).expect(200);
  const proveedor = await request(app).post('/api/proveedores').set('Authorization', token).send({ nombre: 'Distribuidora' }).expect(201);
  const producto = await Producto.create({ nombre: 'Agua', precio_venta: 5 });
  await request(app).post('/api/compras').set('Authorization', token).send({ proveedor_id: proveedor.body._id,
    items: [{ producto_id: producto._id, cantidad: 3, costo_unit: 2 }] }).expect(201);
  expect((await Producto.findById(producto._id)).stock).toBe(3);
  const excel = await request(app).get('/api/reports/compras/excel').set('Authorization', token).expect(200);
  expect(excel.headers['content-type']).toContain('spreadsheetml');
  await request(app).put(permisosURL).set('Authorization', auth(admin)).send({ permisos: [] }).expect(200);
  await request(app).get('/api/compras').set('Authorization', token).expect(403);
  await request(app).post('/api/compras').set('Authorization', token).send({}).expect(403);
  await request(app).get('/api/reports/compras/excel').set('Authorization', token).expect(403);
  expect(await Compra.countDocuments()).toBe(1);
});

test('solo admin asigna permisos y los valores inválidos no cambian la cuenta', async () => {
  const url = `/api/auth/users/${operador._id}/permisos`;
  await request(app).put(url).send({ permisos: ['compras'] }).expect(401);
  await request(app).put(url).set('Authorization', auth(operador)).send({ permisos: ['compras'] }).expect(403);
  for (const permisos of ['compras', ['admin'], [12], ['compras', 'desconocido']]) {
    await request(app).put(url).set('Authorization', auth(admin)).send({ permisos }).expect(400);
  }
  expect((await Usuario.findById(operador._id)).permisos).toEqual([]);
  await request(app).get('/api/compras').expect(401);
  await request(app).get('/api/compras').set('Authorization', auth(admin)).expect(200);
});
