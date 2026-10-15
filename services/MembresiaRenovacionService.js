const mongoose = require('mongoose');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const Cliente = require('../models/Cliente');
const Pago = require('../models/Pago');
const { condicionesPlan, periodosLima } = require('../utils/asistenciaPolicy');
const { DAY, money, id, fechaLima, vistaMembresia, versionFiltro } = require('../utils/membresiaPeriodos');
const { BusinessError, NotFoundError, ConflictError } = require('../middleware/errors/ErrorTypes');
const { montoAnterior, saldosPeriodos } = require('../utils/membresiaSaldo');

async function verificarDeuda(clienteId, session) {
  const membresias = await Membresia.find({ cliente_id: clienteId }).session(session);
  for (const mem of membresias) {
    const pagos = await Pago.find({ membresia_id: mem._id }).session(session).lean();
    const saldo = money(saldosPeriodos(mem, pagos).reduce((s, p) => s + p.pendiente, 0));
    if (saldo > 0) throw new BusinessError(`Debe cancelar primero la deuda anterior: S/ ${saldo.toFixed(2)}.`);
  }
}

async function renovar(membresiaId, data, session, now = new Date()) {
  if (data.caja_id) await require('../utils/membresiaCaja')(data.caja_id, session);
  const mem = await Membresia.findById(membresiaId).session(session);
  if (!mem) throw new NotFoundError('Membresía');
  if (mem.estado === 'cancelado') throw new BusinessError('La membresía está cancelada. Registra una nueva suscripción.');
  if (data.version !== (mem.__v || 0)) throw new ConflictError('La membresía cambió. Recarga antes de renovar.');
  const cliente = await Cliente.findById(mem.cliente_id).session(session);
  if (!cliente?.activo) throw new BusinessError('El cliente no existe o está inactivo.');
  const otra = await Membresia.exists({ cliente_id: mem.cliente_id, _id: { $ne: mem._id },
    estado: { $in: ['activo', 'pendiente'] } }).session(session);
  if (otra) throw new BusinessError('El cliente tiene otra membresía activa o pendiente.');
  if (mem.periodos?.some(p => +p.fecha_inicio > +now)) {
    throw new BusinessError('Ya hay una renovación programada. Espera a que comience.');
  }
  await verificarDeuda(mem.cliente_id, session);
  const plan = await Plan.findOne({ _id: data.plan_id || mem.plan_id, activo: true }).session(session);
  if (!plan) throw new NotFoundError('Plan activo');
  if (!Number.isInteger(plan.duracion_dias) || plan.duracion_dias <= 0 || !Number.isFinite(plan.precio) || plan.precio < 0) {
    throw new BusinessError('El plan debe tener duración y precio válidos.');
  }
  const precio = money(data.precio_acordado ?? (plan.precio - (data.descuento || 0)));
  if (!Number.isFinite(precio) || precio < 0) throw new BusinessError('Precio acordado inválido.');
  const estadoPago = precio === 0 ? 'pagado' : data.estado_pago || 'pagado';
  const monto = money(estadoPago === 'pendiente' ? 0 : (data.monto ?? precio));
  if (!Number.isFinite(monto) || monto < 0 || monto > precio || (precio > 0 && estadoPago === 'pagado' && monto <= 0)) {
    throw new BusinessError('El abono debe ser mayor a cero y no exceder el precio acordado.');
  }
  const vigente = +mem.fecha_fin > +now;
  const inicio = vigente ? new Date(mem.fecha_fin) : data.fecha_inicio ? fechaLima(data.fecha_inicio) : periodosLima(now).inicioDia;
  if (!Number.isFinite(+inicio) || (!vigente && +inicio < +periodosLima(now).inicioDia)) {
    throw new BusinessError('La fecha de renovación debe ser hoy o una fecha posterior.');
  }
  if (vigente && data.fecha_inicio && +fechaLima(data.fecha_inicio) !== +inicio) {
    throw new BusinessError('La renovación anticipada debe comenzar al vencimiento actual.');
  }
  const anterior = await Plan.findById(mem.plan_id).session(session);
  const montoInicial = mem.periodos?.length ? 0 : montoAnterior(mem,
    await Pago.find({ membresia_id: mem._id }).session(session).lean());
  const inicial = { _id: new mongoose.Types.ObjectId(), plan_id: mem.plan_id,
    plan_nombre: mem.plan_nombre || anterior?.nombre || 'Plan anterior', fecha_inicio: mem.fecha_inicio,
    fecha_fin: mem.fecha_fin, duracion_dias: Math.round((mem.fecha_fin - mem.fecha_inicio) / DAY),
    precio_base: mem.precio_base, descuento: mem.precio_base == null ? null : money(Math.max(0, mem.precio_base - montoInicial)),
    monto_total: montoInicial, habilitado: true, inicial: true,
    registrado_en: mem.created_at || mem.fecha_inicio,
    condiciones_asistencia: mem.condiciones_asistencia?.toObject() || condicionesPlan(anterior || {}) };
  const periodo = { _id: new mongoose.Types.ObjectId(), plan_id: plan._id, plan_nombre: plan.nombre,
    fecha_inicio: inicio, fecha_fin: new Date(+inicio + plan.duracion_dias * DAY),
    duracion_dias: plan.duracion_dias, precio_base: money(plan.precio), descuento: money(Math.max(0, plan.precio - precio)),
    monto_total: precio, habilitado: precio === 0 || estadoPago === 'pagado', condiciones_asistencia: condicionesPlan(plan),
    usuario_id: id(data.usuario_id), notas: data.notas || null, registrado_en: now };
  const periods = [...(mem.periodos?.length ? mem.periodos.map(p => p.toObject()) : [inicial]), periodo];
  const pago = new Pago({ cliente_id: mem.cliente_id, membresia_id: mem._id, periodo_id: periodo._id,
    caja_id: data.caja_id, monto: estadoPago === 'pendiente' ? precio : monto,
    metodo_pago: data.metodo_pago || 'efectivo', estado: estadoPago, fecha_pago: now,
    notas: data.notas || null, es_abono: monto < precio && estadoPago === 'pagado',
    numero_abono: monto < precio && estadoPago === 'pagado' ? 1 : null, total_esperado: precio });
  await pago.validate();
  const projected = vistaMembresia({ ...mem.toObject(), periodos: periods }, now);
  const updated = await Membresia.findOneAndUpdate({ ...versionFiltro(mem), estado: mem.estado }, {
    $set: { periodos: periods, fecha_fin: periodo.fecha_fin,
      monto_total: money(periods.reduce((s, p) => s + p.monto_total, 0)), estado: projected.estado,
      plan_id: projected.plan_id, plan_nombre: projected.plan_nombre,
      condiciones_asistencia: projected.condiciones_asistencia }, $inc: { __v: 1 },
  }, { returnDocument: 'after', runValidators: true, session });
  if (!updated) throw new ConflictError('Otra operación modificó la membresía. Recarga antes de renovar.');
  await pago.save({ session });
  return { membresia: updated, periodo, pago, es_abono: pago.es_abono, total_plan: precio };
}

module.exports = { renovar, verificarDeuda };
