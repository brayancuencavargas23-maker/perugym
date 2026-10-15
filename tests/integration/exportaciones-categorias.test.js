const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { clearDatabase, createAuthToken } = require('../helpers/setup');
const Producto = require('../../models/Producto');
const Venta = require('../../models/Venta');
const Caja = require('../../models/Caja');
const Usuario = require('../../models/Usuario');
const MovimientoCaja = require('../../models/MovimientoCaja');
const app = express();
app.use(express.json());
app.use('/api/reports', require('../../routes/reports'));
const auth = `Bearer ${createAuthToken({ id: 'dev', role: 'admin' })}`;
let db;
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri()); }, 60000);
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); await db.stop(); });
async function exportar(endpoint) {
  const res = await request(app).get('/api/reports/' + endpoint).set('Authorization', auth)
    .buffer(true).parse((res, done) => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  return wb;
}
const values = ws => {
  const rows = [];
  ws.eachRow(row => rows.push(row.values.map(value => value?.text || value).join(' | ')));
  return rows.join('\n');
};

test('caja agrupa todas las categorías reales y separa productos sin categoría de ingresos manuales', async () => {
  const usuario = await Usuario.create({ usuario: 'Cajero', email: 'c@test.pe', password: 'x' });
  const caja = await Caja.create({ usuario_id: usuario._id });
  const productos = await Producto.create([
    { nombre: 'Agua', categoria: '  BEBIDAS  ', precio_venta: 3 },
    { nombre: 'Jugo', categoria: 'bebidas', precio_venta: 5 },
    { nombre: 'Barra', categoria: 'Nutrición deportiva', precio_venta: 7 },
    { nombre: 'Sin clasificar', categoria: ' ', precio_venta: 2 },
  ]);
  const items = productos.map(p => ({ producto_id: p._id, cantidad: 1, precio_unit: p.precio_venta, subtotal: p.precio_venta }));
  items.push({ producto_id: new mongoose.Types.ObjectId(), cantidad: 1, precio_unit: 4, subtotal: 4 });
  await Venta.create({ caja_id: caja._id, items });
  await Venta.create({ caja_id: caja._id, anulada: true, items });
  await MovimientoCaja.create({ caja_id: caja._id, usuario_id: usuario._id, tipo: 'ingreso', concepto: 'Servicio extra', monto: 9 });
  const wb = await exportar('ingresos-caja/excel');
  const resumen = wb.getWorksheet('Resumen por Cajero');
  const headers = resumen.getRow(5).values;
  const row = resumen.getRow(6);
  const amount = name => row.getCell(headers.indexOf(name)).value;
  expect(headers.filter(v => v === 'Bebidas')).toHaveLength(1);
  expect(amount('Bebidas')).toBe('S/ 8.00');
  expect(amount('Nutrición Deportiva')).toBe('S/ 7.00');
  expect(amount('Sin categoría')).toBe('S/ 2.00');
  expect(amount('Producto no disponible')).toBe('S/ 4.00');
  expect(amount('Otros ingresos manuales')).toBe('S/ 9.00');
  expect(amount('TOTAL (S/)')).toBe('S/ 30.00');
  const detalle = values(wb.worksheets[1]);
  for (const nombre of ['Agua', 'Jugo', 'Barra', 'Sin clasificar', 'Servicio extra']) expect(detalle).toContain(nombre);
  expect(detalle).not.toContain('Otros productos');
});

test('stock y ventas muestran la misma categoría real por producto', async () => {
  const producto = await Producto.create({ nombre: 'Proteína', categoria: '  NUTRICIÓN deportiva  ', precio_venta: 20 });
  const caja = await Caja.create({ usuario_id: new mongoose.Types.ObjectId() });
  await Venta.create({ caja_id: caja._id, items: [{ producto_id: producto._id, cantidad: 2, precio_unit: 20, subtotal: 40 }] });
  for (const endpoint of ['stock/excel', 'ventas/excel']) {
    const wb = await exportar(endpoint);
    const text = values(wb.worksheets[0]);
    expect(text).toContain('Proteína');
    expect(text).toContain('Nutrición Deportiva');
    expect(text).not.toContain('Sin categoría');
  }
});
