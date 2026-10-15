const DAY = 86400000;
const money = value => Math.round(Number(value) * 100) / 100;
const id = value => String(value?._id || value || '');

function fechaLima(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T05:00:00.000Z`);
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) return new Date(NaN);
    return date;
  }
  return new Date(value);
}

function periodoActual(mem, now = new Date()) {
  const periods = mem.periodos || [];
  return periods.find(p => +new Date(p.fecha_inicio) <= +now && +new Date(p.fecha_fin) > +now)
    || [...periods].reverse().find(p => +new Date(p.fecha_inicio) <= +now) || periods[0] || null;
}

function pagoDelPeriodo(pago, periodo) {
  return !periodo || id(pago.periodo_id) === id(periodo)
    || (periodo.inicial && !pago.periodo_id);
}

function vistaMembresia(mem, now = new Date()) {
  const data = mem.toObject ? mem.toObject() : { ...mem };
  const period = periodoActual(data, now);
  if (!period) return data;
  const vigente = +new Date(period.fecha_inicio) <= +now && +new Date(period.fecha_fin) > +now;
  const estado = data.estado === 'cancelado' ? 'cancelado'
    : !period.habilitado ? 'pendiente' : vigente ? 'activo'
      : +new Date(period.fecha_inicio) > +now ? 'pendiente' : 'vencido';
  return { ...data, plan_id: period.plan_id, plan_nombre: period.plan_nombre,
    precio_base: period.precio_base, monto_periodo: period.monto_total,
    condiciones_asistencia: period.condiciones_asistencia, estado,
    periodo_actual_id: period._id, periodo_inicio: period.fecha_inicio,
    periodo_fin: period.fecha_fin,
    proxima_renovacion: (data.periodos || []).find(p => +new Date(p.fecha_inicio) > +now) || null };
}

function historialPeriodos(mem) {
  if (!mem.periodos?.length) return [mem];
  return mem.periodos.map(p => ({ ...mem, ...p, _id: p._id, membresia_id: mem._id,
    estado: mem.estado === 'cancelado' ? 'cancelado' : p.habilitado ? 'activo' : 'pendiente',
    plan_id: { _id: p.plan_id, nombre: p.plan_nombre }, periodos: undefined }));
}

function versionFiltro(mem) {
  return { _id: mem._id, $or: [{ __v: mem.__v || 0 },
    ...(!mem.__v ? [{ __v: { $exists: false } }] : [])] };
}

module.exports = { DAY, money, id, fechaLima, periodoActual, pagoDelPeriodo, vistaMembresia, historialPeriodos, versionFiltro };
