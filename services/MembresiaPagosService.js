const Membresia = require('../models/Membresia');
const Pago = require('../models/Pago');
const { money, id, periodoActual, vistaMembresia, versionFiltro } = require('../utils/membresiaPeriodos');
const { BusinessError, NotFoundError, ConflictError } = require('../middleware/errors/ErrorTypes');
const { saldosPeriodos } = require('../utils/membresiaSaldo');

async function resumen(mem, periodoId, session = null) {
  const pagos = await Pago.find({ membresia_id: mem._id }).session(session).lean();
  const states = saldosPeriodos(mem, pagos);
  const selected = periodoId ? states.find(p => id(p.periodo) === id(periodoId))
    : states.find(p => p.pendiente > 0) || states.find(p => id(p.periodo) === id(periodoActual(mem))) || states[0];
  if (!selected) throw new NotFoundError('Periodo');
  return { ...selected, periodo: undefined, periodo_id: selected.periodo?._id || null,
    pagos: selected.actuales.filter(p => p.estado === 'pagado').map(p => ({ ...p, id: p._id })) };
}

async function bloquear(mem, session) {
  const result = await Membresia.updateOne(versionFiltro(mem),
    { $inc: { __v: 1 } }, { session });
  if (!result.modifiedCount) throw new ConflictError('Otra operación cambió el saldo. Actualiza e intenta de nuevo.');
}

async function habilitar(mem, periodoId, session) {
  if (periodoId) {
    await Membresia.updateOne({ _id: mem._id, 'periodos._id': periodoId },
      { $set: { 'periodos.$.habilitado': true } }, { session });
    const current = await Membresia.findById(mem._id).session(session);
    const view = vistaMembresia(current);
    if (current.estado !== 'cancelado') await Membresia.updateOne({ _id: mem._id },
      { $set: { estado: view.estado, plan_id: view.plan_id, plan_nombre: view.plan_nombre,
        condiciones_asistencia: view.condiciones_asistencia } }, { session });
  } else if (mem.estado === 'pendiente') {
    await Membresia.updateOne({ _id: mem._id, estado: 'pendiente' },
      { $set: { estado: +mem.fecha_fin > Date.now() ? 'activo' : 'vencido' } }, { session });
  }
}

async function cajaAbierta(cajaId, session) {
  await require('../utils/membresiaCaja')(cajaId, session);
}

async function abonar(data, session) {
  await cajaAbierta(data.caja_id, session);
  const mem = await Membresia.findById(data.membresia_id).session(session);
  if (!mem) throw new NotFoundError('Membresía');
  const state = await resumen(mem, data.periodo_id, session);
  const monto = money(data.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new BusinessError('El abono debe ser mayor a cero.');
  if (state.completado) throw new BusinessError('Este periodo ya está pagado completamente.');
  if (monto > state.pendiente) throw new BusinessError(`El monto excede el saldo pendiente: S/ ${state.pendiente.toFixed(2)}.`);
  await bloquear(mem, session);
  const [pago] = await Pago.create([{ cliente_id: mem.cliente_id, membresia_id: mem._id,
    periodo_id: state.periodo_id, caja_id: data.caja_id, monto, metodo_pago: data.metodo_pago || 'efectivo',
    estado: 'pagado', notas: data.notas || null, es_abono: true, numero_abono: state.pagos.length + 1,
    total_esperado: state.total_plan }], { session });
  // Un cargo pendiente representa solo el saldo restante, nunca se confirma dos veces.
  const pendiente = state.actuales.find(p => p.estado === 'pendiente');
  if (pendiente) {
    if (state.pendiente === monto) await Pago.deleteOne({ _id: pendiente._id, estado: 'pendiente' }, { session });
    else await Pago.updateOne({ _id: pendiente._id, estado: 'pendiente' },
      { $set: { monto: money(state.pendiente - monto) } }, { session });
  }
  await habilitar(mem, state.periodo_id, session);
  return { pago, resumen: { ...state, actuales: undefined, total_pagado: money(state.total_pagado + monto),
    pendiente: money(state.pendiente - monto), completado: state.pendiente === monto } };
}

async function confirmar(pagoId, data, session) {
  await cajaAbierta(data.caja_id, session);
  const pago = await Pago.findById(pagoId).session(session);
  if (!pago) throw new NotFoundError('Pago');
  if (pago.estado !== 'pendiente') throw new BusinessError('Este pago ya fue confirmado.');
  const mem = pago.membresia_id ? await Membresia.findById(pago.membresia_id).session(session) : null;
  let state;
  if (mem) {
    // Los pagos sin periodo_id pertenecen al inicial, no al periodo vigente.
    const periodoId = pago.periodo_id || mem.periodos?.find(p => p.inicial)?._id;
    state = await resumen(mem, periodoId, session);
    if (pago.monto > state.pendiente) throw new BusinessError('El cargo excede el saldo actual. Registra un abono por el saldo restante.');
    await bloquear(mem, session);
  }
  const updated = await Pago.findOneAndUpdate({ _id: pagoId, estado: 'pendiente' },
    { $set: { estado: 'pagado', caja_id: data.caja_id, metodo_pago: data.metodo_pago || pago.metodo_pago,
      fecha_pago: new Date() } }, { returnDocument: 'after', session });
  if (!updated) throw new ConflictError('Este pago ya fue confirmado por otra operación.');
  if (mem) await habilitar(mem, state.periodo_id, session);
  return updated;
}

function presentarPago(pago) {
  const raw = pago.toObject ? pago.toObject() : pago;
  const mem = raw.membresia_id;
  const periodo = mem?.periodos?.find(p => id(p) === id(raw.periodo_id))
    || (!raw.periodo_id ? mem?.periodos?.find(p => p.inicial) : null);
  return { ...raw, id: raw._id,
    cliente_nombre: [raw.cliente_id?.nombre, raw.cliente_id?.apellido_paterno,
      raw.cliente_id?.apellido_materno].filter(Boolean).join(' ') || null,
    plan_nombre: periodo?.plan_nombre || mem?.plan_nombre || mem?.plan_id?.nombre,
    plan_precio: periodo?.precio_base ?? mem?.precio_base ?? mem?.plan_id?.precio,
    periodo_id: periodo?._id || raw.periodo_id, periodo_inicio: periodo?.fecha_inicio,
    periodo_fin: periodo?.fecha_fin, total_esperado: periodo?.monto_total ?? raw.total_esperado ?? mem?.monto_total,
  };
}

module.exports = { resumen, abonar, confirmar, presentarPago };
