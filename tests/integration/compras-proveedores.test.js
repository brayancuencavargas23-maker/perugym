const express = require('express');
const request = require('supertest');
const { setupTestDB, teardownTestDB, clearDatabase, createAuthToken } = require('../helpers/setup');

const Proveedor = require('../../models/Proveedor');
const Producto = require('../../models/Producto');
const Compra = require('../../models/Compra');
const Movimiento = require('../../models/MovimientoInventario');

const app = express();
app.use(express.json());
app.use('/api/productos', require('../../routes/productos'));
app.use('/api/proveedores', require('../../routes/proveedores'));
app.use('/api/compras', require('../../routes/compras'));
app.use('/api/reports', require('../../routes/reports'));

const admin = `Bearer ${createAuthToken({ id: 'dev', role: 'admin', name: 'Ana Admin' })}`;
const recep = `Bearer ${createAuthToken({ id: 'dev', role: 'recepcionista', name: 'Luis Op' })}`;

beforeAll(async () => { await setupTestDB(); }, 60000);
afterEach(clearDatabase);
afterAll(teardownTestDB);

const crearProducto = async (extra = {}) => {
  const res = await request(app)
    .post('/api/productos')
    .set('Authorization', admin)
    .send({ nombre: 'Producto X', precio_venta: 50, stock: 0, ...extra })
    .expect(201);
  return res.body;
};

const crearProveedor = async (extra = {}) => {
  const res = await request(app)
    .post('/api/proveedores')
    .set('Authorization', admin)
    .send({ nombre: 'Distribuidora Andina', telefono: '999888777', ...extra })
    .expect(201);
  return res.body;
};

test('proveedores: crear, editar y desactivar sin borrar el registro', async () => {
  const p = await crearProveedor({ email: 'ventas@andina.pe' });
  expect(p.nombre).toBe('Distribuidora Andina');
  expect(p.activo).toBe(true);

  const upd = await request(app)
    .put(`/api/proveedores/${p._id}`)
    .set('Authorization', admin)
    .send({ telefono: '911222333', contacto: 'María Torres' })
    .expect(200);
  expect(upd.body.telefono).toBe('911222333');
  expect(upd.body.contacto).toBe('María Torres');

  const del = await request(app).delete(`/api/proveedores/${p._id}`).set('Authorization', admin).expect(200);
  expect(del.body.proveedor.activo).toBe(false);
  expect(await Proveedor.findById(p._id)).not.toBeNull();

  const activos = await request(app).get('/api/proveedores?activo=true').set('Authorization', admin).expect(200);
  expect(activos.body.total).toBe(0);
});

test('proveedores: validaciones y permisos', async () => {
  await request(app).post('/api/proveedores').set('Authorization', admin).send({}).expect(400);
  const malEmail = await request(app)
    .post('/api/proveedores')
    .set('Authorization', admin)
    .send({ nombre: 'OK', email: 'no-es-correo' })
    .expect(400);
  expect(malEmail.body.error).toMatch(/correo/i);

  await request(app).post('/api/proveedores').set('Authorization', recep).send({ nombre: 'Nope' }).expect(403);
  await request(app).get('/api/proveedores').set('Authorization', recep).expect(200); // lectura permitida
});

test('registrar compra: aumenta stock y aplica costo de promedio ponderado', async () => {
  const a = await crearProducto({ nombre: 'Proteína', stock: 10 });
  const b = await crearProducto({ nombre: 'Creatina', stock: 4 });
  await Producto.updateOne({ _id: b._id }, { costo: 10 });
  const prov = await crearProveedor();

  const res = await request(app)
    .post('/api/compras')
    .set('Authorization', admin)
    .send({
      proveedor_id: prov._id,
      fecha: '2026-09-20',
      notas: 'Guía de remisión 123',
      items: [
        { producto_id: a._id, cantidad: 5, costo_unit: 20 },
        { producto_id: b._id, cantidad: 6, costo_unit: 20 },
      ],
    })
    .expect(201);

  const compra = res.body;
  expect(compra.costo_total).toBe(220);
  expect(compra.proveedor_nombre).toBe('Distribuidora Andina');
  expect(compra.responsable).toBe('Ana Admin');
  expect(compra.items).toHaveLength(2);
  expect(compra.items[0].nombre).toBe('Proteína');
  expect(compra.items[0].subtotal).toBe(100);

  const pa = await Producto.findById(a._id);
  expect(pa.stock).toBe(15);
  // (10 × 0 + 5 × 20) / 15 = 6.67
  expect(pa.costo).toBeCloseTo(6.67, 2);

  const pb = await Producto.findById(b._id);
  expect(pb.stock).toBe(10);
  // (4 × 10 + 6 × 20) / 10 = 16.00
  expect(pb.costo).toBeCloseTo(16, 2);

  // Movimientos de inventario ligados a la compra
  for (const [prod, cantidad, anterior] of [[a, 5, 10], [b, 6, 4]]) {
    const movs = await Movimiento.find({ producto_id: prod._id, compra_id: compra._id });
    expect(movs).toHaveLength(1);
    expect(movs[0].tipo).toBe('entrada');
    expect(movs[0].cantidad).toBe(cantidad);
    expect(movs[0].stock_anterior).toBe(anterior);
    expect(movs[0].stock_nuevo).toBe(anterior + cantidad);
    expect(movs[0].motivo).toContain('Distribuidora Andina');
  }
});

test('compras inválidas se rechazan (items, cantidades, duplicados, proveedor)', async () => {
  const a = await crearProducto({ nombre: 'Barra', stock: 5 });

  await request(app).post('/api/compras').set('Authorization', admin).send({ items: [] }).expect(400);
  await request(app).post('/api/compras').set('Authorization', admin)
    .send({ items: [{ producto_id: a._id, cantidad: 0, costo_unit: 5 }] }).expect(400);
  await request(app).post('/api/compras').set('Authorization', admin)
    .send({ items: [{ producto_id: a._id, cantidad: 1, costo_unit: -3 }] }).expect(400);

  const dup = await request(app).post('/api/compras').set('Authorization', admin)
    .send({ items: [
      { producto_id: a._id, cantidad: 1, costo_unit: 5 },
      { producto_id: a._id, cantidad: 2, costo_unit: 5 },
    ] }).expect(400);
  expect(dup.body.error).toMatch(/repetirse/i);

  await request(app).post('/api/compras').set('Authorization', admin)
    .send({ items: [{ producto_id: 'no-es-id', cantidad: 1, costo_unit: 5 }] }).expect(400);
  await request(app).post('/api/compras').set('Authorization', admin)
    .send({ items: [{ producto_id: a._id, cantidad: 1, costo_unit: 5 }], proveedor_id: 'ffffffffffffffffffffffff' }).expect(404);

  await request(app).post('/api/compras').set('Authorization', recep)
    .send({ items: [{ producto_id: a._id, cantidad: 1, costo_unit: 5 }] }).expect(403);

  expect(await Compra.countDocuments()).toBe(0);
  expect((await Producto.findById(a._id)).stock).toBe(5); // nada aplicado
});

test('historial, detalle y resumen de valorización', async () => {
  const p = await crearProducto({ nombre: 'Pre', stock: 8 });
  await Producto.updateOne({ _id: p._id }, { costo: 12.5 });
  const prov = await crearProveedor();

  const creada = await request(app).post('/api/compras').set('Authorization', admin)
    .send({ proveedor_id: prov._id, items: [{ producto_id: p._id, cantidad: 2, costo_unit: 25 }] })
    .expect(201);

  // Historial con proveedor popularizado
  const lista = await request(app).get('/api/compras').set('Authorization', admin).expect(200);
  expect(lista.body.total).toBe(1);
  expect(lista.body.data[0].proveedor_id.nombre).toBe('Distribuidora Andina');

  // Detalle con snapshot de nombres
  const det = await request(app).get(`/api/compras/${creada.body._id}`).set('Authorization', admin).expect(200);
  expect(det.body.items[0].nombre).toBe('Pre');
  expect(det.body.costo_total).toBe(50);

  // Resumen: valorización = Σ stock × costo de productos activos
  // stock final 10, costo = (8×12.5 + 2×25)/10 = 15
  const resumen = await request(app).get('/api/compras/resumen').set('Authorization', admin).expect(200);
  expect(resumen.body.valorizacion).toBeCloseTo(150, 2); // 10 × 15
  expect(resumen.body.unidades).toBe(10);
  expect(resumen.body.compras_mes).toBe(50);
  expect(resumen.body.proveedores_activos).toBe(1);

  // Recepcionista no ve compras ni resumen (incluye costos)
  await request(app).get('/api/compras').set('Authorization', recep).expect(403);
  await request(app).get('/api/compras/resumen').set('Authorization', recep).expect(403);
  await request(app).get(`/api/compras/${creada.body._id}`).set('Authorization', recep).expect(403);
});

test('Excel de compras es solo admin y el de stock incluye costo y valorizado', async () => {
  const p = await crearProducto({ nombre: 'Producto Excel', stock: 4 });
  await Producto.updateOne({ _id: p._id }, { costo: 9.9 });
  const comprador = await crearProducto({ nombre: 'Para comprar', stock: 0 });
  await request(app).post('/api/compras').set('Authorization', admin)
    .send({ items: [{ producto_id: comprador._id, cantidad: 3, costo_unit: 7 }] })
    .expect(201);

  const excelCompras = await request(app).get('/api/reports/compras/excel').set('Authorization', admin).expect(200);
  expect(excelCompras.headers['content-type']).toContain('spreadsheetml');
  await request(app).get('/api/reports/compras/excel').set('Authorization', recep).expect(403);

  const excelStock = await request(app).get('/api/reports/stock/excel').set('Authorization', admin).expect(200);
  expect(excelStock.headers['content-type']).toContain('spreadsheetml');
});
