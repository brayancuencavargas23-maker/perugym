const request = require('supertest');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');
const { app, auth, post, contrato } = require('../helpers/membresias-fixture');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');
const Plan = require('../../models/Plan');
const AsistenciaService = require('../../services/AsistenciaService');
const Consultas = require('../../services/MembresiaConsultaService');
const Reportes = require('../../services/ReportesService');
const { periodosLima } = require('../../utils/asistenciaPolicy');

beforeAll(setupTestDB, 60000);
afterEach(clearDatabase);
afterAll(teardownTestDB);

test('listar pagos conserva nombre y precio de cada periodo aunque cambie el catálogo', async () => {
  const f = await contrato();
  const nuevo = await Plan.create({ nombre: 'Trimestral', precio: 270, duracion_dias: 90 });
  const renew = await post(f.url, { ...f.body, plan_id: String(nuevo._id), precio_acordado: 250 }).expect(200);
  await Plan.findByIdAndUpdate(nuevo._id, { nombre: 'Plan modificado', precio: 500 });
  const res = await request(app).get('/api/pagos?limit=500').set('Authorization', auth()).expect(200);
  expect(res.body.data.find(p => p.periodo_id === renew.body.periodo._id))
    .toMatchObject({ plan_nombre: 'Trimestral', total_esperado: 250, plan_precio: 270 });
  expect(res.body.data.find(p => p.periodo_id !== renew.body.periodo._id))
    .toMatchObject({ plan_nombre: 'Mensual', total_esperado: 80, plan_precio: 100 });
  const historial = await request(app).get(`/api/membresias/${f.mem._id}/pagos?periodo_id=${renew.body.periodo._id}`)
    .set('Authorization', auth()).expect(200);
  expect(historial.body).toHaveLength(1);
});

test('reportes cuentan renovación e identifican deuda del plan programado', async () => {
  const f = await contrato({ vigente: true });
  const nuevo = await Plan.create({ nombre: 'Trimestral', precio: 270, duracion_dias: 90 });
  const renew = await post(f.url, { ...f.body, plan_id: String(nuevo._id), precio_acordado: 250,
    estado_pago: 'pendiente' }).expect(200);
  expect((await Reportes.balances())[0]).toMatchObject({ plan: 'Trimestral', saldo: 250,
    periodoId: renew.body.periodo._id });
  const f2 = await contrato();
  await post(f2.url, f2.body).expect(200);
  const today = periodosLima().dia;
  const report = await Reportes.analytics({ from: today, to: today });
  expect(report.daily[0].renovaciones).toBe(1);
  expect(report.stats.saldo).toBe(250);
  expect(report.recommendations.find(r => r.tipo === 'saldo').clave).toContain(renew.body.periodo._id);
});

test('renovaciones posteriores extienden desde el último fin y mantienen todos los periodos', async () => {
  const f = await contrato();
  await post(f.url, f.body).expect(200);
  const first = await Membresia.findById(f.mem._id);
  const next = await post(f.url, { ...f.body, version: 1, precio_acordado: 90 }).expect(200);
  expect(next.body.periodo.fecha_inicio).toBe(first.fecha_fin.toISOString());
  const mem = await Membresia.findById(f.mem._id);
  expect(mem.periodos.map(p => p.monto_total)).toEqual([80, 100, 90]);
  expect(mem.monto_total).toBe(270);
  expect(await Membresia.countDocuments()).toBe(1);
});

test('un sobrepago antiguo no cubre la deuda de otro periodo', async () => {
  const f = await contrato();
  const renew = await post(f.url, { ...f.body, estado_pago: 'pendiente' }).expect(200);
  await Pago.create({ cliente_id: f.cliente._id, membresia_id: f.mem._id, monto: 200, estado: 'pagado' });
  expect((await Consultas.porId(f.mem._id)).saldo_total).toBe(100);
  const debt = await Reportes.balances();
  expect(debt[0]).toMatchObject({ periodoId: renew.body.periodo._id, saldo: 100 });
  await post(f.url, { ...f.body, version: 1 }).expect(400);
});

test('deuda de otra membresía impide renovar y también evita crear otra para eludirla', async () => {
  const f = await contrato();
  await Membresia.create({ cliente_id: f.cliente._id, plan_id: f.plan._id,
    fecha_inicio: new Date(Date.now() - 80 * 86400000), fecha_fin: new Date(Date.now() - 50 * 86400000),
    monto_total: 50, estado: 'vencido' });
  await post(f.url, f.body).expect(400);
  await post('/membresias/suscribir', { cliente_id: String(f.cliente._id), plan_id: String(f.plan._id),
    caja_id: String(f.caja._id), estado_pago: 'pagado' }).expect(400);
  expect(await Membresia.countDocuments()).toBe(2);
});

test('contratos importados sin versión admiten renovación y los gratuitos no generan deuda', async () => {
  const f = await contrato();
  await Membresia.updateOne({ _id: f.mem._id }, { $unset: { __v: 1 } });
  await post(f.url, { ...f.body, precio_acordado: 0, estado_pago: 'pendiente' }).expect(200);
  expect((await Consultas.porId(f.mem._id))).toMatchObject({ precio: 0, saldo_total: 0, estado: 'activo' });
});

test('sincroniza plan y condiciones al comenzar el periodo y permite aplicar políticas al actual', async () => {
  const f = await contrato({ vigente: true });
  await Plan.findByIdAndUpdate(f.plan._id, { limite_semanal: 5 });
  await Membresia.updateOne({ _id: f.mem._id }, { $set: { condiciones_asistencia: { limite_semanal: 3, limite_diario: 1 } } });
  const renew = await post(f.url, f.body).expect(200);
  const future = new Date(+f.mem.fecha_fin + 1000);
  await Consultas.sincronizar(future);
  expect((await Membresia.findById(f.mem._id)).condiciones_asistencia.limite_semanal).toBe(5);
  expect((await AsistenciaService.disponibilidad(f.cliente._id, future)).limite_semanal).toBe(5);
  const entrada = await AsistenciaService.registrar(f.cliente._id, future);
  expect(String(entrada.periodo_id)).toBe(renew.body.periodo._id);
  expect(renew.body.periodo.condiciones_asistencia.limite_semanal).toBe(5);
});
