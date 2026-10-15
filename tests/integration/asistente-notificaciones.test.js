const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { clearDatabase, createAuthToken } = require('../helpers/setup');
const Cliente = require('../../models/Cliente');
const Plan = require('../../models/Plan');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');
const Producto = require('../../models/Producto');
const Asistencia = require('../../models/Asistencia');
const Solicitud = require('../../models/Solicitud');
const Leida = require('../../models/NotificacionLeida');
const Seguimiento = require('../../models/ReporteSeguimiento');
const Notificaciones = require('../../services/NotificacionesService');
const Operaciones = require('../../services/AsistenteOperacionesService');
const { FUNCTIONS_MAP } = require('../../functions/agenteFunctions');
const { DAY, limaDate, parseDate } = require('../../utils/reportDates');

const app = express();
app.use(express.json());
app.use('/api/agente', require('../../routes/agente'));
app.use('/api/dashboard', require('../../routes/dashboard'));
app.use('/api/reports', require('../../routes/reports'));
app.use('/api/solicitudes', require('../../routes/solicitudes'));
const auth = role => `Bearer ${createAuthToken({ id: 'dev', role: role || 'admin' })}`;
let db;
beforeAll(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([Leida.init(), Asistencia.init()]);
}, 60000);
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); if (db) await db.stop(); });

async function seed() {
  const now = new Date();
  const cliente = await Cliente.create({ nombre: 'Ana', apellido_paterno: 'Pérez', telefono: '999 888 777' });
  const plan = await Plan.create({ nombre: 'Interdiario', precio: 100, duracion_dias: 30, limite_semanal: 3 });
  const membresia = await Membresia.create({ cliente_id: cliente._id, plan_id: plan._id, monto_total: 100,
    fecha_inicio: new Date(+now - 20 * DAY), fecha_fin: new Date(+now + 2 * DAY) });
  await Pago.create({ cliente_id: cliente._id, membresia_id: membresia._id, monto: 40, estado: 'pagado', fecha_pago: now });
  const producto = await Producto.create({ nombre: 'Agua', stock: 2, precio_venta: 3 });
  return { cliente, plan, membresia, producto };
}

test('reportes rápidos funcionan sin proveedor IA y generan una descarga real autenticada', async () => {
  await seed();
  const data = await request(app).get('/api/agente/reporte?periodo=hoy').set('Authorization', auth()).expect(200);
  expect(data.body.stats).toMatchObject({ ingresos: 40, saldo: 60 });
  expect(data.body.acciones[0].path).toMatch(/^\/reports\/analytics\/excel\?from=/);
  const excel = await request(app).get('/api' + data.body.acciones[0].path).set('Authorization', auth()).expect(200);
  expect(excel.headers['content-type']).toContain('spreadsheetml');
  await request(app).get('/api' + data.body.acciones[0].path).expect(401);
});

test('PDF de pagos disponible y validación de fechas, tipos y permisos', async () => {
  await seed();
  const data = await request(app).get('/api/agente/reporte?tipo=pagos&formato=pdf').set('Authorization', auth()).expect(200);
  const pdf = await request(app).get('/api' + data.body.acciones[0].path).set('Authorization', auth()).expect(200);
  expect(pdf.headers['content-type']).toContain('application/pdf');
  for (const qs of ['tipo=../../auth', 'tipo=general&formato=pdf', 'from=2026-02-30', 'from=2026-09-10&to=2026-09-01', 'inactiveDays=13']) {
    const endpoint = qs.startsWith('inactiveDays') ? 'recomendaciones' : 'reporte';
    await request(app).get(`/api/agente/${endpoint}?${qs}`).set('Authorization', auth()).expect(400);
  }
  await request(app).get('/api/agente/reporte').expect(401);
  await request(app).get('/api/agente/reporte').set('Authorization', auth('invitado')).expect(403);
});

test('recomendaciones usan saldos reales y omiten seguimientos resueltos', async () => {
  const { cliente, membresia } = await seed();
  const data = await Operaciones.recomendaciones();
  expect(data.respuesta).toContain('60.00');
  expect(data.acciones).toContainEqual(expect.objectContaining({ cliente_id: String(cliente._id), motivo: 'pago' }));
  await Seguimiento.create({ clave: `saldo:${membresia._id}`, estado: 'resuelto', responsable: 'Prueba' });
  const updated = await Operaciones.recomendaciones();
  expect(updated.acciones.some(a => a.motivo === 'pago')).toBe(false);
});

test('búsqueda por nombre completo y metacaracteres no usa regex sin escapar', async () => {
  await seed();
  expect((await Operaciones.buscarClientes('Ana Pérez')).clientes).toHaveLength(1);
  expect((await Operaciones.buscarClientes('.*')).clientes).toHaveLength(0);
  await expect(Operaciones.buscarClientes('a')).rejects.toMatchObject({ status: 400 });
});

test('prepara WhatsApp con teléfono normalizado, saldo real y texto editable sin enviar', async () => {
  const { cliente } = await seed();
  const data = await request(app).post('/api/agente/mensaje').set('Authorization', auth())
    .send({ cliente_id: cliente._id, motivo: 'pago' }).expect(200);
  expect(data.body.acciones[0]).toMatchObject({ tipo: 'mensaje', telefono: '51999888777' });
  expect(data.body.acciones[0].mensaje).toContain('60.00');
  expect(data.body.respuesta).toContain('preparado');
  expect(await Pago.countDocuments()).toBe(1);
  const custom = await Operaciones.prepararMensaje({ cliente_id: cliente._id, mensaje: 'Hola & gracias <Ana>' });
  expect(custom.acciones[0].mensaje).toBe('Hola & gracias <Ana>');
});

test('rechaza destinatarios inválidos y no inventa deuda ni contacto', async () => {
  const { cliente, membresia } = await seed();
  for (const body of [{ cliente_id: 'no' }, { cliente_id: cliente._id, motivo: 'inventado' }, { cliente_id: cliente._id, mensaje: 'x'.repeat(1501) }]) {
    await request(app).post('/api/agente/mensaje').set('Authorization', auth()).send(body).expect(400);
  }
  await Pago.create({ cliente_id: cliente._id, membresia_id: membresia._id, monto: 60 });
  await expect(Operaciones.prepararMensaje({ cliente_id: cliente._id, motivo: 'pago' })).rejects.toThrow('no tiene saldo');
  await Cliente.findByIdAndUpdate(cliente._id, { telefono: '123' });
  await expect(Operaciones.prepararMensaje({ cliente_id: cliente._id })).rejects.toThrow('teléfono válido');
  await Cliente.findByIdAndUpdate(cliente._id, { activo: false });
  await expect(Operaciones.prepararMensaje({ cliente_id: cliente._id })).rejects.toThrow('inactivo');
});

test('check-in del agente respeta la misma restricción diaria del módulo de asistencia', async () => {
  const { cliente } = await seed();
  const first = await FUNCTIONS_MAP.ejecutar_checkin({ cliente_id: cliente._id });
  await FUNCTIONS_MAP.ejecutar_checkout({ cliente_id: cliente._id });
  await expect(FUNCTIONS_MAP.ejecutar_checkin({ cliente_id: cliente._id })).rejects.toThrow('diaria');
  expect(await Asistencia.countDocuments()).toBe(1);
  expect((await Asistencia.findById(first.asistencia_id)).membresia_id).toBeDefined();
});

test('leer alertas persiste por usuario y no elimina su contenido ni la condición del negocio', async () => {
  const { producto } = await seed();
  const first = await Notificaciones.listar('usuario-a');
  expect(first.no_leidas).toBe(2);
  const read = await Notificaciones.marcarLeidas('usuario-a', first.items.map(n => n.clave));
  expect(read).toMatchObject({ total: 2, no_leidas: 0 });
  expect((await Notificaciones.listar('usuario-a')).no_leidas).toBe(0);
  expect((await Notificaciones.listar('usuario-b')).no_leidas).toBe(2);
  expect((await Producto.findById(producto._id)).stock).toBe(2);
  expect(Leida.collection.name).toBe('notificacionleidas');
});

test('marcar un subconjunto no marca novedades no vistas y es idempotente entre pestañas', async () => {
  await seed();
  const first = await Notificaciones.listar('dev');
  const clave = first.items[0].clave;
  await Promise.all(Array.from({ length: 5 }, () => Notificaciones.marcarLeidas('dev', [clave])));
  expect(await Leida.countDocuments()).toBe(1);
  const next = await Notificaciones.listar('dev');
  expect(next.no_leidas).toBe(first.total - 1);
});

test('stock actualizado y un pago nuevo alertan de nuevo aunque el contador total sea igual', async () => {
  const { producto } = await seed();
  let pago = await Pago.create({ monto: 10, estado: 'pendiente' });
  let data = await Notificaciones.listar('dev');
  await Notificaciones.marcarLeidas('dev', data.items.map(n => n.clave));
  await Producto.findByIdAndUpdate(producto._id, { stock: 0 });
  await Pago.findByIdAndUpdate(pago._id, { estado: 'pagado' });
  await Pago.create({ monto: 10, estado: 'pendiente' });
  data = await Notificaciones.listar('dev');
  expect(data.total).toBe(3);
  expect(data.no_leidas).toBe(2);
  expect(data.items.filter(n => !n.leida).map(n => n.tipo)).toEqual(expect.arrayContaining(['stock_bajo', 'pagos_pendientes']));
});

test('pasar de por vencer a vence hoy genera una nueva alerta', async () => {
  const { membresia } = await seed();
  const today = parseDate(limaDate());
  const end = new Date(+today + DAY + 12 * 3600000);
  await Membresia.findByIdAndUpdate(membresia._id, { fecha_fin: end });
  const first = await Notificaciones.listar('dev', today);
  await Notificaciones.marcarLeidas('dev', first.items.map(n => n.clave));
  const next = await Notificaciones.listar('dev', new Date(+today + DAY));
  expect(next.items.find(n => n.tipo === 'vencimiento_hoy').leida).toBe(false);
});

test('API de lectura autentica, valida claves y no confía en usuario enviado en el cuerpo', async () => {
  await seed();
  const first = await request(app).get('/api/dashboard/notifications').set('Authorization', auth()).expect(200);
  expect(first.headers['cache-control']).toBe('no-store');
  await request(app).post('/api/dashboard/notifications/read').send({ claves: [] }).expect(401);
  await request(app).post('/api/dashboard/notifications/read').set('Authorization', auth()).send({ claves: ['invalida'] }).expect(400);
  await request(app).post('/api/dashboard/notifications/read').set('Authorization', auth())
    .send({ claves: first.body.items.map(n => n.clave), usuario_id: 'otro' }).expect(200);
  expect((await Notificaciones.listar('dev')).no_leidas).toBe(0);
  expect((await Notificaciones.listar('otro')).no_leidas).toBe(first.body.total);
});

test('las solicitudes vistas ocultan su badge y una solicitud nueva vuelve a avisar', async () => {
  const { plan } = await seed();
  const sol = await Solicitud.create({ nombre: 'Ana Pérez', telefono: '999888777', plan_id: plan._id });
  const clave = `solicitud:${sol._id}`;

  let stats = await request(app).get('/api/solicitudes/stats').set('Authorization', auth()).expect(200);
  expect(stats.body).toMatchObject({ pendiente: 1, pendiente_no_leidas: 1, total: 1 });
  let notif = await request(app).get('/api/dashboard/notifications').set('Authorization', auth()).expect(200);
  expect(notif.body.items.find(n => n.clave === clave)).toMatchObject({ tipo: 'nueva_solicitud', leida: false });
  const notifSinLeer = notif.body.no_leidas;

  await request(app).post('/api/solicitudes/read').expect(401);
  await request(app).post('/api/solicitudes/read').set('Authorization', auth()).expect(200);

  stats = await request(app).get('/api/solicitudes/stats').set('Authorization', auth()).expect(200);
  expect(stats.body).toMatchObject({ pendiente: 1, pendiente_no_leidas: 0 });
  notif = await request(app).get('/api/dashboard/notifications').set('Authorization', auth()).expect(200);
  expect(notif.body.items.find(n => n.clave === clave).leida).toBe(true);
  expect(notif.body.no_leidas).toBe(notifSinLeer - 1);

  expect(await Notificaciones.solicitudesNoLeidas('otro', [sol._id])).toBe(1);
  expect(await Notificaciones.solicitudesNoLeidas('dev', [sol._id])).toBe(0);

  const sol2 = await Solicitud.create({ nombre: 'Luis Rojas', telefono: '988777666', plan_id: plan._id });
  stats = await request(app).get('/api/solicitudes/stats').set('Authorization', auth()).expect(200);
  expect(stats.body).toMatchObject({ pendiente: 2, pendiente_no_leidas: 1 });
  notif = await request(app).get('/api/dashboard/notifications').set('Authorization', auth()).expect(200);
  expect(notif.body.items.find(n => n.clave === `solicitud:${sol2._id}`).leida).toBe(false);

  await Solicitud.findByIdAndUpdate(sol._id, { estado: 'contactado' });
  stats = await request(app).get('/api/solicitudes/stats').set('Authorization', auth()).expect(200);
  expect(stats.body).toMatchObject({ pendiente: 1, pendiente_no_leidas: 1 });
});
