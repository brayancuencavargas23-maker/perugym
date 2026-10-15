const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { setupTestDB, teardownTestDB, clearDatabase, createAuthToken } = require('../helpers/setup');

const Producto = require('../../models/Producto');
const Movimiento = require('../../models/MovimientoInventario');
const Usuario = require('../../models/Usuario');
const Caja = require('../../models/Caja');

const app = express();
app.use(express.json());
app.use('/api/productos', require('../../routes/productos'));
app.use('/api/ventas', require('../../routes/ventas'));

const admin = `Bearer ${createAuthToken({ id: 'dev', role: 'admin', name: 'Ana Admin' })}`;
const recep = `Bearer ${createAuthToken({ id: 'dev', role: 'recepcionista', name: 'Luis Op' })}`;

beforeAll(async () => { await setupTestDB(); }, 60000);
afterEach(clearDatabase);
afterAll(teardownTestDB);

const crearProducto = async (extra = {}) => {
  const res = await request(app)
    .post('/api/productos')
    .set('Authorization', admin)
    .send({ nombre: 'Proteína 1kg', precio_venta: 120, stock: 10, stock_minimo: 3, ...extra })
    .expect(201);
  return res.body;
};

const movimientosDe = async id => {
  const res = await request(app).get(`/api/productos/${id}/movimientos`).set('Authorization', admin).expect(200);
  return res.body;
};

test('crear un producto registra el movimiento inicial en el historial', async () => {
  const p = await crearProducto({ stock: 10 });
  expect(p.stock).toBe(10);
  expect(p.stock_minimo).toBe(3);

  const { data, total } = await movimientosDe(p._id);
  expect(total).toBe(1);
  expect(data[0]).toMatchObject({
    tipo: 'inicial',
    stock_anterior: 0,
    stock_nuevo: 10,
    cantidad: 10,
    motivo: 'Stock inicial al crear el producto',
    responsable: 'Ana Admin',
    usuario_id: 'dev',
  });
});

test('registrar una entrada suma stock y guarda cantidad, motivo y responsable', async () => {
  const p = await crearProducto({ stock: 10 });

  const res = await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'entrada', cantidad: 5, motivo: 'Reposición de proveedor' })
    .expect(201);
  expect(res.body.stock).toBe(15);

  const { data, total } = await movimientosDe(p._id);
  expect(total).toBe(2);
  expect(data[0]).toMatchObject({
    tipo: 'entrada',
    cantidad: 5,
    stock_anterior: 10,
    stock_nuevo: 15,
    motivo: 'Reposición de proveedor',
    responsable: 'Ana Admin',
  });
});

test('un ajuste exige motivo y stock_anterior exacto: rechaza desactualizado con 409 y aplica el correcto', async () => {
  const p = await crearProducto({ stock: 10 });

  const desactualizado = await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'ajuste', stock_nuevo: 8, stock_anterior: 9, motivo: 'Conteo físico' })
    .expect(409);
  expect(desactualizado.body.error).toMatch(/stock cambi/i);
  expect((await Producto.findById(p._id)).stock).toBe(10);

  const ok = await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'ajuste', stock_nuevo: 8, stock_anterior: 10, motivo: 'Conteo físico' })
    .expect(201);
  expect(ok.body.stock).toBe(8);

  const { data } = await movimientosDe(p._id);
  expect(data[0]).toMatchObject({ tipo: 'ajuste', cantidad: -2, stock_anterior: 10, stock_nuevo: 8, motivo: 'Conteo físico' });
});

test('movimientos inválidos se rechazan: sin motivo, cantidad no entera o tipo desconocido', async () => {
  const p = await crearProducto({ stock: 10 });

  const sinMotivo = await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'entrada', cantidad: 2, motivo: '   ' })
    .expect(400);
  expect(sinMotivo.body.error).toMatch(/motivo/i);

  const noEntera = await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'entrada', cantidad: 2.5, motivo: 'Compra fraccionada' })
    .expect(400);
  expect(noEntera.body.error).toMatch(/entero/i);

  await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'venta', cantidad: 1, motivo: 'Intento directo' })
    .expect(400);

  expect((await Producto.findById(p._id)).stock).toBe(10);
  expect(await Movimiento.countDocuments({ producto_id: p._id })).toBe(1); // solo el inicial
});

test('PUT con stock en el body devuelve 400 indicando el camino correcto y no cambia existencias', async () => {
  const p = await crearProducto({ stock: 10 });

  const res = await request(app)
    .put(`/api/productos/${p._id}`)
    .set('Authorization', admin)
    .send({ nombre: p.nombre, precio_venta: 130, stock: 50 })
    .expect(400);
  expect(res.body.error).toMatch(/entrada|ajuste/i);

  const actual = await Producto.findById(p._id);
  expect(actual.stock).toBe(10);
  expect(actual.precio_venta).toBe(120); // la edición completa tampoco se aplicó
});

test('DELETE desactiva el producto y conserva el historial de movimientos', async () => {
  const p = await crearProducto({ stock: 10 });
  await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'entrada', cantidad: 4, motivo: 'Reposición' })
    .expect(201);

  const res = await request(app).delete(`/api/productos/${p._id}`).set('Authorization', admin).expect(200);
  expect(res.body.producto.activo).toBe(false);

  const enBD = await Producto.findById(p._id);
  expect(enBD).not.toBeNull();           // nunca se borra
  expect(enBD.stock).toBe(14);           // existencias intactas
  expect(await Movimiento.countDocuments({ producto_id: p._id })).toBe(2); // historial intacto

  const bloqueado = await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', admin)
    .send({ tipo: 'entrada', cantidad: 1, motivo: 'Reactivar primero' })
    .expect(400);
  expect(bloqueado.body.error).toMatch(/activa/i);
});

test('una recepcionista no puede crear productos ni registrar movimientos (403)', async () => {
  const p = await crearProducto({ stock: 10 });

  await request(app)
    .post('/api/productos')
    .set('Authorization', recep)
    .send({ nombre: 'Nope', precio_venta: 10 })
    .expect(403);

  await request(app)
    .post(`/api/productos/${p._id}/movimientos`)
    .set('Authorization', recep)
    .send({ tipo: 'entrada', cantidad: 1, motivo: 'Intento' })
    .expect(403);

  expect(await Producto.countDocuments()).toBe(1);
  expect(await Movimiento.countDocuments({ producto_id: p._id })).toBe(1);
});

test('las ventas descuentan stock con movimiento tipo "venta" y la anulación lo revierte con "anulacion"', async () => {
  const p = await crearProducto({ stock: 10 });
  const cajero = await Usuario.create({ usuario: 'caja1', email: 'caja1@p.gym', password: 'x', rol: 'recepcionista' });
  const caja = await Caja.create({ usuario_id: cajero._id, monto_inicial: 50 });

  const ventaRes = await request(app)
    .post('/api/ventas')
    .set('Authorization', admin)
    .send({ caja_id: caja._id, metodo_pago: 'efectivo', items: [{ producto_id: p._id, cantidad: 3 }] })
    .expect(201);
  const ventaId = ventaRes.body._id;

  expect((await Producto.findById(p._id)).stock).toBe(7);
  let { data } = await movimientosDe(p._id);
  expect(data[0]).toMatchObject({ tipo: 'venta', cantidad: -3, stock_anterior: 10, stock_nuevo: 7 });
  expect(String(data[0].venta_id)).toBe(String(ventaId));

  await request(app).put(`/api/ventas/${ventaId}/anular`).set('Authorization', admin).expect(200);

  expect((await Producto.findById(p._id)).stock).toBe(10);
  ({ data } = await movimientosDe(p._id));
  expect(data[0]).toMatchObject({ tipo: 'anulacion', cantidad: 3, stock_anterior: 7, stock_nuevo: 10 });
  expect(String(data[0].venta_id)).toBe(String(ventaId));

  const venta = await mongoose.connection.collection('ventas').findOne({ _id: new mongoose.Types.ObjectId(ventaId) });
  expect(venta.anulada).toBe(true);
});
