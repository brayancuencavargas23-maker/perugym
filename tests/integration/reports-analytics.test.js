const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { setupTestDB, teardownTestDB, clearDatabase, createAuthToken } = require('../helpers/setup');
const Cliente = require('../../models/Cliente');
const Plan = require('../../models/Plan');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');
const Producto = require('../../models/Producto');
const Venta = require('../../models/Venta');
const MovimientoCaja = require('../../models/MovimientoCaja');
const Asistencia = require('../../models/Asistencia');
const Reportes = require('../../services/ReportesService');
const { dateFilter, period, limaDate, parseDate, DAY } = require('../../utils/reportDates');

const app = express();
app.use(express.json());
app.use('/reports', require('../../routes/reports'));
app.use('/dashboard', require('../../routes/dashboard'));
const auth = () => 'Bearer ' + createAuthToken({ id: 'dev', role: 'admin', name: 'Admin de prueba' });
const now = new Date('2026-09-26T18:00:00Z');
const query = { from: '2026-09-01', to: '2026-09-15' };

beforeAll(setupTestDB, 120000);
afterAll(teardownTestDB);
beforeEach(clearDatabase);

async function seed() {
  const cliente = await Cliente.create({ nombre: 'Ana', apellido_paterno: 'Pérez', telefono: '999999999' });
  const plan = await Plan.create({ nombre: 'Mensual', precio: 100, duracion_dias: 30 });
  const member = await Membresia.create({ cliente_id: cliente._id, plan_id: plan._id, monto_total: 100, fecha_inicio: '2026-09-01T05:00:00Z', fecha_fin: '2026-10-01T05:00:00Z' });
  const caja = new mongoose.Types.ObjectId();
  await Pago.create([
    { cliente_id: cliente._id, membresia_id: member._id, monto: 30, es_abono: true, estado: 'pagado', fecha_pago: '2026-09-01T05:00:00Z' },
    { cliente_id: cliente._id, membresia_id: member._id, monto: 20, es_abono: true, estado: 'pagado', fecha_pago: '2026-09-16T04:59:59Z' },
    { monto: 900, estado: 'pendiente', fecha_pago: '2026-09-10T12:00:00Z' },
    { monto: 40, estado: 'pagado', fecha_pago: '2026-08-31T12:00:00Z' },
    { monto: 999, estado: 'pagado', fecha_pago: '2026-09-16T05:00:00Z' }
  ]);
  const product = await Producto.create({ nombre: 'Agua', precio_venta: 5, stock: 1 });
  await Venta.create({ caja_id: caja, fecha_venta: '2026-09-05T12:00:00Z', items: [{ producto_id: product._id, cantidad: 4, precio_unit: 5, subtotal: 20 }] });
  await Venta.create({ caja_id: caja, anulada: true, fecha_venta: '2026-09-05T12:00:00Z', items: [{ producto_id: product._id, cantidad: 100, precio_unit: 5, subtotal: 500 }] });
  await MovimientoCaja.create([
    { caja_id: caja, usuario_id: caja, tipo: 'ingreso', es_rutina: true, monto: 10, concepto: 'Rutina', fecha: '2026-09-05T12:00:00Z' },
    { caja_id: caja, usuario_id: caja, tipo: 'ingreso', monto: 5, concepto: 'Otro', fecha: '2026-09-05T12:00:00Z' },
    { caja_id: caja, usuario_id: caja, tipo: 'egreso', monto: 8, concepto: 'Gasto', fecha: '2026-09-05T12:00:00Z' }
  ]);
  await Asistencia.create({ cliente_id: cliente._id, entrada: '2026-09-16T04:30:00Z' });
  return { member, cliente, plan };
}

test('Lima: incluye el último día completo y compara igual cantidad de días', () => {
  expect(dateFilter('2026-09-15', '2026-09-15')).toEqual({ $gte: new Date('2026-09-15T05:00:00Z'), $lt: new Date('2026-09-16T05:00:00Z') });
  expect(period(query, now)).toMatchObject({ days: 15, previousFrom: '2026-08-17', previousTo: '2026-08-31' });
  expect(() => dateFilter('2026-02-30', '2026-03-01')).toThrow();
  expect(() => period({ from: '2026-09-15', to: '2026-09-01' }, now)).toThrow();
});

test('concilia cobros, excluye pendientes/anulaciones y calcula deuda parcial sin duplicarla', async () => {
  await seed();
  const data = await Reportes.analytics(query, now);
  expect(data.stats).toMatchObject({ ingresos: 85, anterior: 40, saldo: 50, deudores: 1, nuevos: 1, activos: 1, visitas: 1, egresos: 8 });
  expect(data.sources).toEqual({ membresias: 50, productos: 20, rutinas: 10, otros: 5 });
  expect(data.debts[0]).toMatchObject({ nombre: 'Ana Pérez', acordado: 100, pagado: 50, saldo: 50 });
  expect(data.daily[14].actual).toBe(20);
  expect(data.heatmap[1][23]).toBe(1);
  expect(data.products[0]).toMatchObject({ unidades: 4, ingresos: 20, diasStock: 3.75 });
  expect(data.stockAlerts).toHaveLength(1);
  expect(data.stats.renovacion).toBeNull();
});

test('registra seguimiento compartido con responsable y lo devuelve en el análisis', async () => {
  const { member } = await seed();
  const clave = `saldo:${member._id}`;
  await request(app).put('/reports/seguimiento').set('Authorization', auth()).send({ clave, estado: 'contactado' }).expect(200);
  const data = await Reportes.analytics(query, now);
  expect(data.recommendations.find(r => r.clave === clave).seguimiento).toMatchObject({ estado: 'contactado', responsable: 'Admin de prueba' });
  await request(app).put('/reports/seguimiento').set('Authorization', auth()).send({ clave, estado: 'inventado' }).expect(400);
});

test('renovación evalúa solo ventanas completas y excluye altas recientes del seguimiento por inactividad', async () => {
  const { cliente, plan, member } = await seed();
  await Membresia.findByIdAndUpdate(member._id, { fecha_inicio: '2026-08-01T05:00:00Z', fecha_fin: '2026-09-02T05:00:00Z', estado: 'vencido' });
  await Membresia.create({ cliente_id: cliente._id, plan_id: plan._id, monto_total: 100, fecha_inicio: '2026-09-04T05:00:00Z', fecha_fin: '2026-10-04T05:00:00Z' });
  const recent = await Cliente.create({ nombre: 'Nuevo' });
  await Membresia.create({ cliente_id: recent._id, plan_id: plan._id, monto_total: 0, fecha_inicio: '2026-09-25T05:00:00Z', fecha_fin: '2026-10-25T05:00:00Z' });
  const data = await Reportes.analytics(query, now);
  expect(data.stats).toMatchObject({ elegibles: 1, renovados: 1, renovacion: 100, inactivos: 0 });
  expect(data.daily[3].renovaciones).toBe(1);
  expect(data.debts).toHaveLength(2);
});

test('sin historial no inventa porcentajes; valida filtros y autorización', async () => {
  const data = await Reportes.analytics(query, now);
  expect(data.stats).toMatchObject({ ingresos: 0, variacion: null, renovacion: null, saldo: 0 });
  expect(data.daily).toHaveLength(15);
  await request(app).get('/reports/analytics').expect(401);
  await request(app).get('/reports/analytics').set('Authorization', 'Bearer ' + createAuthToken({ id: 'dev', role: 'entrenador' })).expect(403);
  await request(app).get('/reports/analytics?from=2026-02-30&to=2026-03-01').set('Authorization', auth()).expect(400);
  await request(app).get('/reports/analytics?inactiveDays=999').set('Authorization', auth()).expect(400);
});

test('dashboard compara períodos equivalentes y cuenta vigencia, no clientes habilitados', async () => {
  const today = parseDate(limaDate(new Date()));
  const current = period({}, new Date());
  const cliente = await Cliente.create({ nombre: 'Vigente' });
  await Cliente.create({ nombre: 'Sin membresía', activo: true });
  const plan = await Plan.create({ nombre: 'Plan', precio: 100, duracion_dias: 30 });
  await Membresia.create({ cliente_id: cliente._id, plan_id: plan._id, fecha_inicio: new Date(+today-DAY), fecha_fin: new Date(+today+DAY) });
  await Pago.create([
    { monto: 100, estado: 'pagado', fecha_pago: today },
    { monto: 50, estado: 'pagado', fecha_pago: current.previousStart },
    { monto: 9999, estado: 'pagado', fecha_pago: new Date(+current.previousStart-1) }
  ]);
  const res = await request(app).get('/dashboard?periodo=mes').set('Authorization', auth()).expect(200);
  expect(res.body.stats).toMatchObject({ clientesActivos: 1, ingresosDelMes: 100, tendencias: { ingresos: 100, asistencia: null } });
});

function binary(res, callback) {
  const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => callback(null, Buffer.concat(chunks)));
}

test('Excel operativo incluye abonos y último día; análisis exportado coincide con la pantalla', async () => {
  await seed();
  const response = await request(app).get('/reports/analytics/excel?from=2026-09-01&to=2026-09-15').set('Authorization', auth()).buffer(true).parse(binary).expect(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(response.body);
  expect(wb.getWorksheet('Resumen').getCell('B5').value).toBe(85);
  expect(wb.getWorksheet('Saldos actuales').getCell('E2').value).toBe(50);
  const pending = await request(app).get('/reports/pagos-pendientes/excel').set('Authorization', auth()).buffer(true).parse(binary).expect(200);
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(pending.body);
  expect(wb2.getWorksheet('Pagos Pendientes').getCell('G6').value).toBe(50);
  const payments = await request(app).get('/reports/pagos/excel?from=2026-09-15&to=2026-09-15').set('Authorization', auth()).buffer(true).parse(binary).expect(200);
  const wb3 = new ExcelJS.Workbook(); await wb3.xlsx.load(payments.body);
  expect(wb3.getWorksheet('Pagos').getCell('D6').value).toBe(20);
});

test('agrupa ingresos por método de pago y los exporta al Excel', async () => {
  const { member, cliente } = await seed();
  await Pago.create({ cliente_id: cliente._id, membresia_id: member._id, monto: 15, estado: 'pagado', metodo_pago: 'yape', fecha_pago: '2026-09-10T12:00:00Z' });
  await MovimientoCaja.create({ caja_id: new mongoose.Types.ObjectId(), usuario_id: new mongoose.Types.ObjectId(), tipo: 'ingreso', monto: 7, metodo_pago: 'plin', concepto: 'Ingreso', fecha: '2026-09-10T12:00:00Z' });

  const data = await Reportes.analytics(query, now);
  expect(data.methods).toEqual({ efectivo: 85, yape: 15, plin: 7 });

  const response = await request(app).get('/reports/analytics/excel?from=2026-09-01&to=2026-09-15').set('Authorization', auth()).buffer(true).parse(binary).expect(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(response.body);
  const ws = wb.getWorksheet('Métodos de pago');
  expect(ws).toBeTruthy();
  expect([ws.getCell('A2').value, ws.getCell('B2').value]).toEqual(['Efectivo', 85]);
  expect([ws.getCell('A3').value, ws.getCell('B3').value]).toEqual(['Yape', 15]);
  expect([ws.getCell('A4').value, ws.getCell('B4').value]).toEqual(['Plin', 7]);
  expect(ws.getCell('C2').value).toBe(79.4);
});
