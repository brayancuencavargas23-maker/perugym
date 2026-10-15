const Pago = require('../models/Pago');
const Venta = require('../models/Venta');
const MovimientoCaja = require('../models/MovimientoCaja');
const Membresia = require('../models/Membresia');
const Asistencia = require('../models/Asistencia');
const Producto = require('../models/Producto');
const Seguimiento = require('../models/ReporteSeguimiento');
const { DAY, limaDate, period } = require('../utils/reportDates');
const { historialPeriodos } = require('../utils/membresiaPeriodos');
const { saldosPeriodos } = require('../utils/membresiaSaldo');

const money = n => Math.round((Number(n) || 0) * 100) / 100;
const name = c => c ? [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ') : 'Cliente eliminado';
const id = value => String(value?._id || value || '');

// Saldos actuales: no se usa el precio actual del plan como deuda histórica.
async function balances() {
  const [memberships, payments] = await Promise.all([
    Membresia.find({ estado: { $ne: 'cancelado' } }).select('cliente_id plan_id monto_total fecha_inicio fecha_fin estado periodos')
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno telefono dni email')
      .populate('plan_id', 'nombre').lean(),
    Pago.find().select('membresia_id periodo_id monto estado total_esperado').lean()
  ]);
  const groups = new Map();
  payments.forEach(p => { const key = id(p.membresia_id); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); });
  return memberships.flatMap(m => saldosPeriodos(m, groups.get(id(m)) || []).flatMap(p => {
    const balance = p.pendiente;
    const current = p.periodo;
    return balance > 0 ? [{ id: id(m), periodoId: current ? id(current) : null, clienteId: id(m.cliente_id), nombre: name(m.cliente_id),
      telefono: m.cliente_id?.telefono || '', dni: m.cliente_id?.dni || '', email: m.cliente_id?.email || '',
      plan: current?.plan_nombre || m.plan_id?.nombre || '-', acordado: p.total_plan, pagado: p.total_pagado, saldo: balance,
      fecha: current?.fecha_inicio || m.fecha_inicio, vencimiento: current?.fecha_fin || m.fecha_fin }] : [];
  })).sort((a, b) => b.saldo - a.saldo);
}

async function analytics(query, now = new Date()) {
  const p = period(query, now);
  const inactiveDays = Number(query.inactiveDays || 14);
  if (![7, 14, 30].includes(inactiveDays)) throw new Error('El umbral de inactividad debe ser 7, 14 o 30 días.');
  const range = { $gte: p.previousStart, $lt: p.end };
  const [payments, sales, movements, memberships, attendance, products, debts, firstPayments, lastVisits] = await Promise.all([
    Pago.find({ estado: 'pagado', fecha_pago: range }).select('fecha_pago monto metodo_pago').lean(),
    Venta.find({ anulada: false, fecha_venta: range }).select('fecha_venta items metodo_pago').lean(),
    MovimientoCaja.find({ fecha: range }).select('fecha monto tipo es_rutina metodo_pago').lean(),
    Membresia.find({ estado: { $ne: 'cancelado' } }).select('cliente_id plan_id fecha_inicio fecha_fin estado periodos')
      .populate('cliente_id', 'nombre apellido_paterno apellido_materno telefono')
      .populate('plan_id', 'nombre').lean(),
    Asistencia.find({ entrada: { $gte: p.start, $lt: p.end } }).select('entrada cliente_id').lean(),
    Producto.find({ activo: true }).select('nombre stock').lean(),
    balances(),
    Pago.aggregate([{ $match: { estado: 'pagado', membresia_id: { $ne: null }, cliente_id: { $ne: null } } },
      { $group: { _id: '$cliente_id', first: { $min: '$fecha_pago' } } },
      { $match: { first: { $gte: p.start, $lt: p.end } } },
      { $lookup: { from: 'clientes', localField: '_id', foreignField: '_id', as: 'cliente' } },
      { $project: { first: 1, cliente: { $arrayElemAt: ['$cliente', 0] } } }]),
    Asistencia.aggregate([{ $match: { entrada: { $lte: now } } }, { $group: { _id: '$cliente_id', last: { $max: '$entrada' } } }])
  ]);
  const daily = Array.from({ length: p.days }, (_, i) => ({ fecha: limaDate(new Date(+p.start + i * DAY)),
    anteriorFecha: limaDate(new Date(+p.previousStart + i * DAY)), actual: 0, anterior: 0, altas: 0, renovaciones: 0 }));
  const sources = { membresias: 0, productos: 0, rutinas: 0, otros: 0 };
  const methods = {};
  let expenses = 0;
  function add(date, amount, source, method) {
    const current = date >= p.start;
    const i = Math.floor((date - (current ? p.start : p.previousStart)) / DAY);
    if (!daily[i]) return;
    daily[i][current ? 'actual' : 'anterior'] += amount;
    if (current) { sources[source] += amount; methods[method] = (methods[method] || 0) + amount; }
  }
  payments.forEach(v => add(v.fecha_pago, v.monto, 'membresias', v.metodo_pago));
  sales.forEach(v => add(v.fecha_venta, v.items.reduce((s, x) => s + x.subtotal, 0), 'productos', v.metodo_pago));
  movements.forEach(v => {
    if (v.tipo === 'ingreso') add(v.fecha, v.monto, v.es_rutina ? 'rutinas' : 'otros', v.metodo_pago);
    else if (v.fecha >= p.start) expenses += v.monto;
  });
  daily.forEach(d => { d.actual = money(d.actual); d.anterior = money(d.anterior); });
  Object.keys(sources).forEach(k => { sources[k] = money(sources[k]); });
  Object.keys(methods).forEach(k => { methods[k] = money(methods[k]); });
  const income = money(daily.reduce((s, d) => s + d.actual, 0));
  const previousIncome = money(daily.reduce((s, d) => s + d.anterior, 0));
  const trend = previousIncome ? money((income - previousIncome) / previousIncome * 100) : null;
  const clients = new Map();
  memberships.flatMap(historialPeriodos).forEach(m => { const key = id(m.cliente_id); if (!key) return; if (!clients.has(key)) clients.set(key, []); clients.get(key).push(m); });
  const active = new Map();
  const inactive = [], expiring = [], renewals = [], plans = new Map();
  const visits = new Map(lastVisits.map(v => [id(v._id), v.last]));
  let eligible = 0, renewed = 0;
  for (const [clientId, history] of clients) {
    history.sort((a, b) => a.fecha_inicio - b.fecha_inicio);
    history.forEach((m, index) => {
      if (m.estado !== 'pendiente' && m.fecha_inicio >= p.start && m.fecha_inicio < p.end) {
        const i = Math.floor((m.fecha_inicio - p.start) / DAY);
        daily[i][index ? 'renovaciones' : 'altas']++;
        const plan = m.plan_id?.nombre || 'Plan eliminado';
        plans.set(plan, (plans.get(plan) || 0) + 1);
      }
    });
    // Una oportunidad por cliente; solo ventanas de 7 días ya completadas.
    const candidates = history.filter(m => m.estado !== 'pendiente' && m.fecha_fin >= p.start && m.fecha_fin < p.end && +m.fecha_fin + 7 * DAY <= +now);
    const last = candidates[candidates.length - 1];
    if (last) {
      eligible++;
      const next = history.find(m => m !== last && m.estado !== 'pendiente' && m.fecha_inicio >= last.fecha_fin && +m.fecha_inicio <= +last.fecha_fin + 7 * DAY);
      if (next) renewed++;
      renewals.push({ nombre: name(last.cliente_id), plan: last.plan_id?.nombre || '-', fecha: last.fecha_fin, resultado: next ? 'Renovó en 7 días' : 'Sin renovación en 7 días' });
    }
    const current = history.find(m => m.estado === 'activo' && m.fecha_inicio <= now && m.fecha_fin >= now);
    if (!current) continue;
    active.set(clientId, current);
    const client = { id: id(current), clienteId: clientId, nombre: name(current.cliente_id), telefono: current.cliente_id?.telefono || '', plan: current.plan_id?.nombre || '-' };
    const latestVisit = visits.get(clientId);
    const since = latestVisit && latestVisit > current.fecha_inicio ? latestVisit : current.fecha_inicio;
    if (+now - since >= inactiveDays * DAY) inactive.push({ ...client, fecha: latestVisit || null, dias: Math.floor((now - since) / DAY) });
    if (+current.fecha_fin <= +now + 7 * DAY && !history.some(m => m !== current && m.estado !== 'pendiente' && m.fecha_inicio >= current.fecha_fin)) {
      expiring.push({ ...client, fecha: current.fecha_fin, dias: Math.ceil((current.fecha_fin - now) / DAY) });
    }
  }
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  attendance.forEach(a => { const local = new Date(+a.entrada - 5 * 3600000); heatmap[(local.getUTCDay() + 6) % 7][local.getUTCHours()]++; });
  const sold = new Map();
  sales.filter(s => s.fecha_venta >= p.start).forEach(s => s.items.forEach(i => {
    const key = id(i.producto_id), row = sold.get(key) || { unidades: 0, ingresos: 0 };
    row.unidades += i.cantidad; row.ingresos += i.subtotal; sold.set(key, row);
  }));
  const productRows = products.map(v => { const totals = sold.get(id(v)) || { unidades: 0, ingresos: 0 };
    return { id: id(v), nombre: v.nombre, stock: v.stock, ...totals, ingresos: money(totals.ingresos), diasStock: totals.unidades ? money(v.stock / (totals.unidades / p.days)) : null }; }).sort((a, b) => b.unidades - a.unidades);
  const recommendations = [
    ...inactive.map(v => ({ ...v, tipo: 'inasistencia', clave: `inasistencia:${v.id}:${limaDate(v.fecha || active.get(v.clienteId).fecha_inicio)}`, motivo: `${v.dias} días sin asistencia desde la última visita o inicio de membresía.`, accion: 'Contactar al cliente', prioridad: 'media' })),
    ...expiring.map(v => ({ ...v, tipo: 'vencimiento', clave: `vencimiento:${v.id}`, motivo: `Membresía vence en ${v.dias} días.`, accion: 'Coordinar renovación', prioridad: 'alta' })),
    ...debts.map(v => ({ ...v, tipo: 'saldo', clave: `saldo:${v.id}${v.periodoId ? ':' + v.periodoId : ''}`, motivo: `Saldo por cobrar: S/ ${v.saldo.toFixed(2)}.`, accion: 'Gestionar abono en Pagos', prioridad: 'alta' }))
  ];
  const tracking = await Seguimiento.find({ clave: { $in: recommendations.map(r => r.clave) } }).lean();
  const trackingMap = new Map(tracking.map(t => [t.clave, t]));
  recommendations.forEach(r => { const t = trackingMap.get(r.clave); r.seguimiento = t ? { estado: t.estado, responsable: t.responsable, actualizado: t.actualizado } : { estado: 'pendiente' }; });
  return { periodo: { from: p.from, to: p.to, previousFrom: p.previousFrom, previousTo: p.previousTo, days: p.days }, actualizado: now,
    stats: { ingresos: income, anterior: previousIncome, variacion: trend, activos: active.size,
      nuevos: firstPayments.length,
      renovacion: eligible ? money(renewed / eligible * 100) : null, elegibles: eligible, renovados: renewed,
      saldo: money(debts.reduce((s, d) => s + d.saldo, 0)), deudores: new Set(debts.map(d => d.clienteId)).size,
      inactivos: inactive.length, visitas: attendance.length, visitantes: new Set(attendance.map(a => id(a.cliente_id))).size, egresos: money(expenses) },
    daily, sources, methods, heatmap, plans: [...plans].map(([nombre, cantidad]) => ({ nombre, cantidad })),
    debts, renewals, products: productRows, recommendations,
    activeClients: [...active.values()].map(m => ({ nombre: name(m.cliente_id), plan: m.plan_id?.nombre || '-', inicio: m.fecha_inicio, fin: m.fecha_fin })),
    newClients: firstPayments.map(v => ({ nombre: name(v.cliente), fecha: v.first })), inactiveClients: inactive,
    stockAlerts: productRows.filter(v => v.stock <= 0 || (v.diasStock !== null && v.diasStock <= 7)),
    incomeAlert: previousIncome > 0 && trend <= -15 && p.days >= 7 };
}

module.exports = { analytics, balances };
