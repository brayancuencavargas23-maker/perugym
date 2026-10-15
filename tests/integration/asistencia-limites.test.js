const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');
const { createAuthToken, clearDatabase } = require('../helpers/setup');
const Cliente = require('../../models/Cliente');
const Plan = require('../../models/Plan');
const Membresia = require('../../models/Membresia');
const Asistencia = require('../../models/Asistencia');
const AsistenciaService = require('../../services/AsistenciaService');
const MembresiaService = require('../../services/MembresiaService');
const { periodosLima } = require('../../utils/asistenciaPolicy');

const app = express();
app.use(express.json());
app.use('/api/asistencia', require('../../routes/asistencia'));
app.use('/api/planes', require('../../routes/planes'));
const auth = () => `Bearer ${createAuthToken({ id: 'dev', role: 'admin' })}`;
const date = day => new Date(`2026-09-${day}T15:00:00-05:00`);
let db;

async function contrato(limite = 3) {
  const cliente = await Cliente.create({ nombre: 'Cliente de prueba' });
  const plan = await Plan.create({ nombre: 'Interdiario', precio: 90, duracion_dias: 30, limite_semanal: limite });
  const membresia = await MembresiaService.crear({ cliente_id: cliente._id, plan_id: plan._id,
    fecha_inicio: '2026-09-01T05:00:00Z', fecha_fin: '2026-11-01T05:00:00Z' }, null);
  return { cliente, plan, membresia };
}

async function visitar(cliente, when) {
  const entrada = await AsistenciaService.registrar(cliente._id, when);
  await Asistencia.findByIdAndUpdate(entrada._id, { salida: new Date(+when + 3600000) });
  return entrada;
}

beforeAll(async () => {
  // Standalone: comprobar que las garantías también funcionan sin transacciones.
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Asistencia.init();
}, 60000);
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); if (db) await db.stop(); });

test('permite tres visitas, bloquea la cuarta y renueva el cupo el lunes', async () => {
  const { cliente, membresia } = await contrato();
  for (const day of [21, 23, 25]) {
    const entrada = await visitar(cliente, date(day));
    expect(String(entrada.membresia_id)).toBe(String(membresia._id));
  }
  const estado = await AsistenciaService.disponibilidad(cliente._id, date(26));
  expect(estado).toMatchObject({ permitido: false, visitas_semana: 3, disponibles: 0 });
  await expect(AsistenciaService.registrar(cliente._id, date(26))).rejects.toThrow('Límite semanal');
  await expect(visitar(cliente, date(28))).resolves.toBeDefined();
  expect(await Asistencia.countDocuments()).toBe(4);
});

test('la salida no devuelve la visita diaria ni el cupo semanal', async () => {
  const { cliente } = await contrato();
  await visitar(cliente, date(21));
  await expect(AsistenciaService.registrar(cliente._id, new Date(+date(21) + 7200000)))
    .rejects.toThrow('Máximo una visita diaria');
  expect((await AsistenciaService.disponibilidad(cliente._id, date(22))).visitas_semana).toBe(1);
});

test('bloquea una sesión abierta incluso de un día anterior', async () => {
  const { cliente } = await contrato();
  await AsistenciaService.registrar(cliente._id, date(21));
  await expect(AsistenciaService.registrar(cliente._id, date(22))).rejects.toThrow('sin salida');
});

test.each(['pendiente', 'cancelado', 'vencido'])('bloquea membresía %s', async estado => {
  const { cliente, membresia } = await contrato();
  await Membresia.findByIdAndUpdate(membresia._id, { estado });
  await expect(AsistenciaService.registrar(cliente._id, date(21))).rejects.toThrow('vigente');
});

test('comprueba fechas aunque el estado siga activo', async () => {
  const { cliente, membresia } = await contrato();
  await Membresia.findByIdAndUpdate(membresia._id, { fecha_inicio: date(22) });
  await expect(AsistenciaService.registrar(cliente._id, date(21))).rejects.toThrow('vigente');
  await Membresia.findByIdAndUpdate(membresia._id, { fecha_inicio: date(20), fecha_fin: date(21) });
  await expect(AsistenciaService.registrar(cliente._id, date(21))).rejects.toThrow('vigente');
});

test('bloquea cliente inexistente, inactivo o sin membresía', async () => {
  await expect(AsistenciaService.registrar('invalido')).rejects.toMatchObject({ status: 400 });
  await expect(AsistenciaService.registrar(new mongoose.Types.ObjectId())).rejects.toMatchObject({ status: 404 });
  const { cliente, membresia } = await contrato();
  await Cliente.findByIdAndUpdate(cliente._id, { activo: false });
  await expect(AsistenciaService.registrar(cliente._id, date(21))).rejects.toThrow('inactivo');
  await Cliente.findByIdAndUpdate(cliente._id, { activo: true });
  await Membresia.findByIdAndDelete(membresia._id);
  await expect(AsistenciaService.registrar(cliente._id, date(21))).rejects.toThrow('vigente');
});

test('conserva condiciones contratadas al editar un plan y copia las nuevas al cambiarlo', async () => {
  const { cliente, plan, membresia } = await contrato();
  await Plan.findByIdAndUpdate(plan._id, { limite_semanal: 5 });
  expect((await AsistenciaService.disponibilidad(cliente._id, date(21))).limite_semanal).toBe(3);
  const nueva = await MembresiaService.cambiarPlan(membresia._id,
    { plan_id: plan._id, fecha_inicio: date(21) }, null);
  expect(nueva.condiciones_asistencia.limite_semanal).toBe(5);
});

test('renovar copia las condiciones actuales y no borra asistencias de la semana', async () => {
  const { cliente, plan, membresia } = await contrato();
  const now = new Date();
  await Membresia.findByIdAndUpdate(membresia._id, { estado: 'vencido', fecha_fin: new Date(+now - 86400000), monto_total: 0 });
  await Asistencia.create({ cliente_id: cliente._id, entrada: now, salida: now });
  await Plan.findByIdAndUpdate(plan._id, { limite_semanal: 2 });
  const result = await MembresiaService.renovar(membresia._id, { version: 0, estado_pago: 'pagado' }, null);
  const nueva = result.membresia;
  expect(nueva.condiciones_asistencia.limite_semanal).toBe(2);
  expect((await AsistenciaService.disponibilidad(cliente._id)).visitas_semana).toBe(1);
});

test('el historial antiguo también consume cupo y las membresías antiguas adoptan una copia', async () => {
  const { cliente, membresia } = await contrato();
  await Membresia.updateOne({ _id: membresia._id }, { $unset: { condiciones_asistencia: 1 } });
  await Asistencia.insertMany([21, 23, 25].map(day => ({ cliente_id: cliente._id, entrada: date(day), salida: date(day) })));
  await expect(AsistenciaService.registrar(cliente._id, date(26))).rejects.toThrow('Límite semanal');
  expect((await Membresia.findById(membresia._id)).condiciones_asistencia.limite_semanal).toBe(3);
});

test('plan sin límite semanal permite más de tres visitas pero solo una al día', async () => {
  const { cliente } = await contrato(null);
  for (const day of [21, 22, 23, 24]) await visitar(cliente, date(day));
  await expect(AsistenciaService.registrar(cliente._id, date(24))).rejects.toThrow('diaria');
  expect((await AsistenciaService.disponibilidad(cliente._id, date(25))).disponibles).toBeNull();
});

test('los cupos no utilizados no se acumulan entre semanas', async () => {
  const { cliente } = await contrato();
  await visitar(cliente, date(21));
  const estado = await AsistenciaService.disponibilidad(cliente._id, date(28));
  expect(estado).toMatchObject({ disponibles: 3, visitas_semana: 0 });
});

test('dos recepcionistas no pueden consumir simultáneamente el último cupo', async () => {
  const { cliente } = await contrato();
  await visitar(cliente, date(21));
  await visitar(cliente, date(23));
  const resultados = await Promise.allSettled(Array.from({ length: 10 }, () => AsistenciaService.registrar(cliente._id, date(25))));
  expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(await Asistencia.countDocuments({ cliente_id: cliente._id })).toBe(3);
});

test('semana y día cambian a medianoche de Lima, no a medianoche UTC', () => {
  const antes = periodosLima(new Date('2026-09-28T04:59:59Z'));
  const despues = periodosLima(new Date('2026-09-28T05:00:00Z'));
  expect(antes.dia).toBe('2026-09-27');
  expect(antes.semana).toBe('2026-09-21');
  expect(despues.dia).toBe('2026-09-28');
  expect(despues.semana).toBe('2026-09-28');
});

test('API valida configuración y permite aplicar explícitamente a contratos existentes', async () => {
  const { plan, membresia } = await contrato();
  for (const limite_semanal of [0, 8, -1, 1.5, '3']) {
    await request(app).put(`/api/planes/${plan._id}`).set('Authorization', auth())
      .send({ limite_semanal }).expect(400);
  }
  await request(app).put(`/api/planes/${plan._id}`).set('Authorization', auth())
    .send({ limite_semanal: 4 }).expect(200);
  expect((await Membresia.findById(membresia._id)).condiciones_asistencia.limite_semanal).toBe(3);
  await request(app).put(`/api/planes/${plan._id}`).set('Authorization', auth())
    .send({ limite_semanal: 4, aplicar_membresias: true }).expect(200);
  expect((await Membresia.findById(membresia._id)).condiciones_asistencia.limite_semanal).toBe(4);
});

test('editar plan congela contratos antiguos sin alterar sus condiciones', async () => {
  const { plan, membresia } = await contrato();
  await Membresia.updateOne({ _id: membresia._id }, { $unset: { condiciones_asistencia: 1 } });
  await request(app).put(`/api/planes/${plan._id}`).set('Authorization', auth())
    .send({ limite_semanal: 5 }).expect(200);
  expect((await Membresia.findById(membresia._id)).condiciones_asistencia.limite_semanal).toBe(3);
});

test('API entrega cupos frescos y rechaza segunda entrada sin crear registros', async () => {
  const { cliente, membresia } = await contrato();
  const now = Date.now();
  await Membresia.findByIdAndUpdate(membresia._id, {
    fecha_inicio: new Date(now - 86400000), fecha_fin: new Date(now + 86400000),
  });
  const disponibilidad = await request(app).get(`/api/asistencia/disponibilidad/${cliente._id}`)
    .set('Authorization', auth()).expect(200);
  expect(disponibilidad.headers['cache-control']).toBe('no-store');
  expect(disponibilidad.body).toMatchObject({ permitido: true, disponibles: 3 });
  const entrada = await request(app).post('/api/asistencia/checkin').set('Authorization', auth())
    .send({ cliente_id: cliente._id }).expect(201);
  expect(entrada.body.membresia_id).toBe(String(membresia._id));
  await request(app).put(`/api/asistencia/checkout/${entrada.body.id}`).set('Authorization', auth()).send({}).expect(200);
  const rechazada = await request(app).post('/api/asistencia/checkin').set('Authorization', auth())
    .send({ cliente_id: cliente._id }).expect(400);
  expect(rechazada.body.error).toContain('diaria');
  expect(await Asistencia.countDocuments()).toBe(1);
});
