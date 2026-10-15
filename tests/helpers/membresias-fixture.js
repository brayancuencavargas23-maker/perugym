const express = require('express');
const request = require('supertest');
const { createAuthToken } = require('./setup');
const Cliente = require('../../models/Cliente');
const Plan = require('../../models/Plan');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');
const Caja = require('../../models/Caja');
const { errorHandler } = require('../../middleware/errorHandler');
const app = express();
app.use(express.json());
app.use('/api/membresias', require('../../routes/membresias'));
app.use('/api/pagos', require('../../routes/pagos'));
app.use(errorHandler);
const auth = role => `Bearer ${createAuthToken({ id: 'dev', role: role || 'admin' })}`;
const post = (url, body, role) => request(app).post(`/api${url}`).set('Authorization', auth(role)).send(body);

async function contrato({ vigente = false, pagado = 80 } = {}) {
  const cliente = await Cliente.create({ nombre: 'Ana', activo: true });
  const plan = await Plan.create({ nombre: 'Mensual', precio: 100, duracion_dias: 30, limite_semanal: 3 });
  const caja = await Caja.create({ estado: 'abierta' });
  const fin = new Date(Date.now() + (vigente ? 5 : -5) * 86400000);
  const mem = await Membresia.create({ cliente_id: cliente._id, plan_id: plan._id,
    fecha_inicio: new Date(+fin - 30 * 86400000), fecha_fin: fin,
    estado: vigente ? 'activo' : 'vencido', monto_total: 80, precio_base: 100 });
  if (pagado) await Pago.create({ membresia_id: mem._id, cliente_id: cliente._id, caja_id: caja._id, monto: pagado, estado: 'pagado' });
  const body = { version: 0, plan_id: String(plan._id), precio_acordado: 100, estado_pago: 'pagado', caja_id: String(caja._id) };
  return { cliente, plan, caja, mem, body, url: `/membresias/${mem._id}/renovar` };
}

module.exports = { app, auth, post, contrato };
