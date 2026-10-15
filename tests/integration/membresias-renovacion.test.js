const request = require('supertest');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');
const { app, auth, post, contrato } = require('../helpers/membresias-fixture');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');
const Plan = require('../../models/Plan');
const AsistenciaService = require('../../services/AsistenciaService');
const Pagos = require('../../services/MembresiaPagosService');
const { vistaMembresia, historialPeriodos } = require('../../utils/membresiaPeriodos');
const { periodosLima } = require('../../utils/asistenciaPolicy');

beforeAll(setupTestDB, 60000);
afterEach(clearDatabase);
afterAll(teardownTestDB);

test('renueva desde hoy en Lima, conserva ID, precio anterior y pagos separados', async () => {
  const f = await contrato();
  const res = await post(f.url, f.body).expect(200);
  expect(res.body.membresia.id).toBe(String(f.mem._id));
  expect(await Membresia.countDocuments()).toBe(1);
  expect(res.body.periodo.fecha_inicio).toBe(periodosLima().inicioDia.toISOString());
  const mem = await Membresia.findById(f.mem._id);
  expect(mem.monto_total).toBe(180);
  expect(mem.periodos.map(p => p.monto_total)).toEqual([80, 100]);
  expect(res.body.membresia).toMatchObject({ precio: 100, total_pagado: 100, saldo_total: 0 });
  const original = await Pagos.resumen(mem, mem.periodos[0]._id);
  expect(original).toMatchObject({ total_plan: 80, total_pagado: 80, pendiente: 0 });
  await request(app).get(`/api/membresias/${f.mem._id}/periodos`).set('Authorization', auth()).expect(200);
});

test('permite fecha futura editable pero rechaza fechas anteriores a hoy', async () => {
  const f = await contrato();
  await post(f.url, { ...f.body, fecha_inicio: '2020-01-01' }).expect(400);
  const next = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const res = await post(f.url, { ...f.body, fecha_inicio: next }).expect(200);
  expect(res.body.periodo.fecha_inicio).toBe(`${next}T05:00:00.000Z`);
  await expect(AsistenciaService.disponibilidad(f.cliente._id)).rejects.toThrow('vigente');
});

test('programa otro plan al vencer, mantiene acceso anterior y aplica el nuevo después', async () => {
  const f = await contrato({ vigente: true });
  const plan = await Plan.create({ nombre: 'Trimestral', precio: 270, duracion_dias: 90, limite_semanal: 5 });
  const res = await post(f.url, { ...f.body, plan_id: String(plan._id), precio_acordado: 250 }).expect(200);
  expect(res.body.periodo.fecha_inicio).toBe(f.mem.fecha_fin.toISOString());
  expect(res.body.membresia.plan_nombre).toBe('Mensual');
  const before = await AsistenciaService.disponibilidad(f.cliente._id);
  expect(before.limite_semanal).toBe(3);
  const after = await AsistenciaService.disponibilidad(f.cliente._id, new Date(+f.mem.fecha_fin + 1000));
  expect(after).toMatchObject({ plan_nombre: 'Trimestral', limite_semanal: 5 });
  const mem = await Membresia.findById(f.mem._id);
  expect(vistaMembresia(mem).proxima_renovacion.monto_total).toBe(250);
  expect(historialPeriodos(mem.toObject()).map(p => p.plan_id.nombre)).toEqual(['Mensual', 'Trimestral']);
  await post(f.url, { ...f.body, version: 1 }).expect(400);
});

test('no permite adelantar el inicio del plan en una renovación activa', async () => {
  const f = await contrato({ vigente: true });
  const res = await post(f.url, { ...f.body, fecha_inicio: periodosLima().dia }).expect(400);
  expect(res.body.error).toContain('vencimiento actual');
});

test('exige cancelar deuda del cliente antes de renovar incluso con precio nuevo menor', async () => {
  const f = await contrato({ pagado: 40 });
  const res = await post(f.url, { ...f.body, precio_acordado: 10 }).expect(400);
  expect(res.body.error).toContain('cancelar primero');
  await post('/pagos/abono', { membresia_id: String(f.mem._id), monto: 40, caja_id: String(f.caja._id) }).expect(201);
  await post(f.url, { ...f.body, version: 1 }).expect(200);
});

test('abonos de renovación no reutilizan pagos anteriores; cobra solo saldo al confirmar', async () => {
  const f = await contrato();
  const res = await post(f.url, { ...f.body, estado_pago: 'pendiente' }).expect(200);
  await post('/pagos/abono', { membresia_id: String(f.mem._id), periodo_id: res.body.periodo._id,
    monto: 30, caja_id: String(f.caja._id) }).expect(201);
  const pending = await Pago.findById(res.body.pago._id);
  expect(pending.monto).toBe(70);
  const state = await request(app).get(`/api/pagos/${f.mem._id}/estado-pago?periodo_id=${res.body.periodo._id}`)
    .set('Authorization', auth()).expect(200);
  expect(state.body).toMatchObject({ total_plan: 100, total_pagado: 30, pendiente: 70 });
  await request(app).put(`/api/pagos/${pending._id}/confirmar`).set('Authorization', auth())
    .send({ caja_id: String(f.caja._id) }).expect(200);
  const mem = await Membresia.findById(f.mem._id);
  expect((await Pagos.resumen(mem, res.body.periodo._id)).pendiente).toBe(0);
  expect((await Pagos.resumen(mem, mem.periodos[0]._id)).total_pagado).toBe(80);
});

test('renovación pendiente futura no quita acceso hoy ni lo permite al vencer sin pago', async () => {
  const f = await contrato({ vigente: true });
  const res = await post(f.url, { ...f.body, estado_pago: 'pendiente' }).expect(200);
  expect((await AsistenciaService.disponibilidad(f.cliente._id)).permitido).toBe(true);
  await expect(AsistenciaService.disponibilidad(f.cliente._id, new Date(+f.mem.fecha_fin + 1000)))
    .rejects.toThrow('vigente');
  await post('/pagos/abono', { membresia_id: String(f.mem._id), periodo_id: res.body.periodo._id,
    monto: 20, caja_id: String(f.caja._id) }).expect(201);
  expect((await AsistenciaService.disponibilidad(f.cliente._id, new Date(+f.mem.fecha_fin + 1000))).permitido).toBe(true);
});

test('valida plan activo, precio, cliente, caja y autorización', async () => {
  const f = await contrato();
  await request(app).post(`/api${f.url}`).send(f.body).expect(401);
  await post(f.url, f.body, 'sin-permiso').expect(403);
  await post(f.url, { ...f.body, precio_acordado: -1 }).expect(400);
  await post(f.url, { ...f.body, caja_id: undefined }).expect(400);
  await require('../../models/Cliente').findByIdAndUpdate(f.cliente._id, { activo: false });
  await post(f.url, f.body).expect(400);
  await require('../../models/Cliente').findByIdAndUpdate(f.cliente._id, { activo: true });
  await Plan.findByIdAndUpdate(f.plan._id, { activo: false });
  await post(f.url, f.body).expect(404);
  expect(await Pago.countDocuments()).toBe(1);
  await Plan.findByIdAndUpdate(f.plan._id, { activo: true });
  await post(f.url, f.body, 'recepcionista').expect(200);
});

test('rechaza versiones obsoletas, sobrepagos y edición directa de periodos', async () => {
  const f = await contrato();
  await post(f.url, { ...f.body, monto: 120 }).expect(400);
  await post(f.url, f.body).expect(200);
  await post(f.url, f.body).expect(409);
  await request(app).put(`/api/membresias/${f.mem._id}`).set('Authorization', auth())
    .send({ fecha_fin: '2030-01-01' }).expect(400);
});

test('la transacción revierte el periodo si falla el registro del pago', async () => {
  const f = await contrato();
  const save = jest.spyOn(Pago.prototype, 'save').mockRejectedValueOnce(new Error('Fallo simulado'));
  await post(f.url, f.body).expect(500);
  save.mockRestore();
  expect((await Membresia.findById(f.mem._id)).periodos).toBeUndefined();
  expect(await Pago.countDocuments()).toBe(1);
});
