const express = require('express');
const request = require('supertest');
const { setupTestDB, teardownTestDB, clearDatabase, createAuthToken } = require('../helpers/setup');
const Producto = require('../../models/Producto');
const Compra = require('../../models/Compra');
const Lote = require('../../models/Lote');
const app = express();
app.use(express.json());
app.use('/api/compras', require('../../routes/compras'));
app.use('/api/productos', require('../../routes/productos'));
const auth = `Bearer ${createAuthToken({ id: 'dev', role: 'admin' })}`;
beforeAll(setupTestDB, 60000);
afterEach(clearDatabase);
afterAll(teardownTestDB);

test('la fecha elegida de compra y vencimiento se conservan en Lima, también al filtrar el historial', async () => {
  const producto = await Producto.create({ nombre: 'Agua', precio_venta: 5 });
  const compra = await request(app).post('/api/compras').set('Authorization', auth).send({ fecha: '2026-10-14',
    items: [{ producto_id: producto._id, cantidad: 5, costo_unit: 2, fecha_vencimiento: '2027-01-01' }] }).expect(201);
  expect(compra.body.fecha).toBe('2026-10-14T05:00:00.000Z');
  expect(compra.body.items[0].fecha_vencimiento).toBe('2027-01-01T05:00:00.000Z');
  const lote = await Lote.findOne({ compra_id: compra.body._id });
  expect(lote.fecha_vencimiento.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  const listado = await request(app).get('/api/compras?desde=2026-10-14&hasta=2026-10-14').set('Authorization', auth).expect(200);
  expect(listado.body.data.map(c => c._id)).toEqual([compra.body._id]);
  const otroDia = await request(app).get('/api/compras?desde=2026-10-13&hasta=2026-10-13').set('Authorization', auth).expect(200);
  expect(otroDia.body.total).toBe(0);
  const manual = await request(app).post(`/api/productos/${producto._id}/lotes`).set('Authorization', auth)
    .send({ cantidad: 1, fecha_vencimiento: '2027-01-01' }).expect(201);
  expect(manual.body.fecha_vencimiento).toBe('2027-01-01T05:00:00.000Z');
});

test('fechas inexistentes e intervalos invertidos no se normalizan silenciosamente', async () => {
  const producto = await Producto.create({ nombre: 'Agua', precio_venta: 5 });
  const item = { producto_id: producto._id, cantidad: 1, costo_unit: 2 };
  await request(app).post('/api/compras').set('Authorization', auth).send({ fecha: '2026-02-30', items: [item] }).expect(400);
  await request(app).post('/api/compras').set('Authorization', auth)
    .send({ items: [{ ...item, fecha_vencimiento: '2026-02-30' }] }).expect(400);
  await request(app).post(`/api/productos/${producto._id}/lotes`).set('Authorization', auth)
    .send({ cantidad: 1, fecha_vencimiento: '2026-02-30' }).expect(400);
  await request(app).get('/api/compras?desde=2026-10-15&hasta=2026-10-14').set('Authorization', auth).expect(400);
  expect(await Compra.countDocuments()).toBe(0);
  expect((await Producto.findById(producto._id)).stock).toBe(0);
});
