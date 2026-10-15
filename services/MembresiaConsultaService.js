const Membresia = require('../models/Membresia');
const Pago = require('../models/Pago');
const { vistaMembresia, periodoActual, pagoDelPeriodo, money, id, versionFiltro } = require('../utils/membresiaPeriodos');
const { saldosPeriodos } = require('../utils/membresiaSaldo');

async function presentar(mem, now = new Date(), payments) {
  const raw = mem.toObject ? mem.toObject() : mem;
  const data = vistaMembresia(raw, now);
  const periodo = periodoActual(raw, now);
  const pagos = payments ?? await Pago.find({ membresia_id: raw._id }).lean();
  const actuales = pagos.filter(p => p.estado === 'pagado' && pagoDelPeriodo(p, periodo));
  const states = saldosPeriodos(raw, pagos);
  const saldo = money(states.reduce((s, p) => s + p.pendiente, 0));
  const precio = periodo?.monto_total ?? states[0].total_plan;
  return { ...data, id: raw._id, cliente_id: raw.cliente_id,
    cliente_nombre: raw.cliente_id?.nombre ? [raw.cliente_id.nombre, raw.cliente_id.apellido_paterno,
      raw.cliente_id.apellido_materno].filter(Boolean).join(' ') : null,
    cliente_telefono: raw.cliente_id?.telefono || null, foto_url: raw.cliente_id?.foto_url,
    plan_nombre: data.plan_nombre || raw.plan_id?.nombre, precio,
    precio_original: periodo ? periodo.precio_base : raw.precio_base ?? raw.plan_id?.precio,
    total_pagado: money(actuales.reduce((s, p) => s + p.monto, 0)), cantidad_abonos: actuales.length,
    saldo_total: saldo,
    version: raw.__v || 0, plan_actual_id: id(data.plan_id),
  };
}

async function listar(mems) {
  const pagos = await Pago.find({ membresia_id: { $in: mems.map(m => m._id) } }).lean();
  const groups = new Map();
  for (const pago of pagos) {
    const key = id(pago.membresia_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pago);
  }
  const now = new Date();
  return Promise.all(mems.map(mem => presentar(mem, now, groups.get(id(mem)) || [])));
}

async function porId(memId) {
  const mem = await Membresia.findById(memId)
    .populate('cliente_id', 'nombre apellido_paterno apellido_materno foto_url telefono')
    .populate('plan_id', 'nombre precio');
  return mem ? presentar(mem) : null;
}

async function sincronizar(now = new Date()) {
  const membresias = await Membresia.find({ 'periodos.0': { $exists: true }, estado: { $ne: 'cancelado' } });
  for (const mem of membresias) {
    const view = vistaMembresia(mem, now);
    const current = periodoActual(mem, now);
    if (view.estado === mem.estado && id(view.plan_id) === id(mem.plan_id)
      && current.plan_nombre === mem.plan_nombre
      && current.condiciones_asistencia?.limite_semanal === mem.condiciones_asistencia?.limite_semanal) continue;
    await Membresia.updateOne({ ...versionFiltro(mem), estado: { $ne: 'cancelado' } },
      { $set: { estado: view.estado, plan_id: view.plan_id, plan_nombre: view.plan_nombre,
        condiciones_asistencia: current.condiciones_asistencia } });
  }
}

module.exports = { presentar, listar, porId, sincronizar };
