const mongoose = require('mongoose');
const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const ReportesService = require('./ReportesService');
const { DAY, limaDate, parseDate, period } = require('../utils/reportDates');

const money = n => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n);
const nombre = c => [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ');
function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }

function rango(args = {}, now = new Date()) {
  const today = limaDate(now);
  const presets = { hoy: today, semana: limaDate(new Date(+parseDate(today) - 6 * DAY)), mes: `${today.slice(0, 7)}-01` };
  if (args.periodo && !presets[args.periodo]) throw invalid('Período inválido. Usa hoy, semana o mes.');
  let p;
  try { p = period({ from: args.from || presets[args.periodo || 'mes'], to: args.to || today }, now); }
  catch (err) { throw invalid(err.message); }
  return { from: p.from, to: p.to, inactiveDays: args.inactiveDays || 14 };
}

async function generarReporte(args = {}) {
  const tipo = args.tipo || 'general';
  const formato = args.formato || 'excel';
  const tipos = { general: 'analytics', pagos: 'pagos', asistencia: 'asistencia', membresias: 'membresias', ventas: 'ventas', stock: 'stock', 'pagos-pendientes': 'pagos-pendientes' };
  if (!Object.hasOwn(tipos, tipo) || !['excel', 'pdf'].includes(formato) || (formato === 'pdf' && tipo !== 'pagos')) {
    throw invalid('Selecciona un reporte válido. PDF está disponible para pagos; los demás se descargan en Excel.');
  }
  const query = rango(args);
  const data = await ReportesService.analytics(query);
  const s = data.stats;
  const respuesta = `Reporte ${tipo}: ${query.from} al ${query.to} (Perú).\n` +
    `• Ingresos cobrados: ${money(s.ingresos)}. Egresos registrados: ${money(s.egresos)}.\n` +
    `• Asistencias del período: ${s.visitas}; clientes únicos: ${s.visitantes}.\n` +
    `• Clientes con membresía vigente hoy: ${s.activos}.\n` +
    `• Saldo actual por cobrar: ${money(s.saldo)} (${s.deudores} clientes).\n` +
    `• Comparación con ${data.periodo.previousFrom} al ${data.periodo.previousTo}: ${s.variacion == null ? 'sin base de comparación' : `${s.variacion}% en ingresos`}.\n` +
    'Descarga el detalle con el botón. Los saldos y la vigencia son actuales; los ingresos no equivalen a utilidad.';
  return { respuesta, periodo: data.periodo, stats: s, acciones: [{ tipo: 'descarga',
    titulo: `Descargar ${tipo} (${formato === 'excel' ? 'Excel' : 'PDF'})`,
    path: `/reports/${tipos[tipo]}/${formato}?${new URLSearchParams({ from: query.from, to: query.to })}`,
    archivo: `perugym-${tipo}-${query.from}-${query.to}.${formato === 'excel' ? 'xlsx' : 'pdf'}` }] };
}

async function recomendaciones(args = {}) {
  const query = rango(args);
  if (![7, 14, 30].includes(Number(query.inactiveDays))) throw invalid('Usa 7, 14 o 30 días de inactividad.');
  const data = await ReportesService.analytics(query);
  const pending = data.recommendations.filter(r => r.seguimiento.estado !== 'resuelto')
    .sort((a, b) => (a.prioridad === 'alta' ? 0 : 1) - (b.prioridad === 'alta' ? 0 : 1));
  const lines = [];
  if (data.incomeAlert) lines.push(`Ingresos ${Math.abs(data.stats.variacion)}% por debajo del período anterior comparable: revisa renovaciones y cobros.`);
  pending.slice(0, 8).forEach(r => lines.push(`${r.nombre}: ${r.motivo} ${r.accion}.`));
  data.stockAlerts.slice(0, 3).forEach(p => lines.push(`${p.nombre}: stock ${p.stock}. Revisa reposición${p.diasStock == null ? '' : ` (cobertura estimada: ${p.diasStock} días)`}.`));
  return { respuesta: lines.length
    ? `Recomendaciones basadas en datos actuales (${limaDate()}):\n${lines.map(l => `• ${l}`).join('\n')}\n${pending.length} seguimientos abiertos en total. Las señales de inasistencia no implican abandono confirmado.`
    : 'No se detectaron seguimientos abiertos ni alertas de ingresos o stock para este período.',
  acciones: pending.slice(0, 8).filter(r => r.clienteId).map(r => ({ tipo: 'preparar_mensaje',
    titulo: `Mensaje para ${r.nombre}`, cliente_id: r.clienteId,
    motivo: { saldo: 'pago', vencimiento: 'renovacion', inasistencia: 'inasistencia' }[r.tipo] })),
  total_seguimientos: pending.length };
}

async function buscarClientes(q) {
  if (typeof q !== 'string' || q.trim().length < 2 || q.length > 100) throw invalid('Escribe al menos 2 caracteres y hasta 100 para buscar al cliente.');
  const words = q.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const clientes = await Cliente.find({ activo: true, $and: words.map(word => ({ $or: ['nombre', 'apellido_paterno', 'apellido_materno', 'dni'].map(field => ({ [field]: { $regex: word, $options: 'i' } })) })) })
    .select('nombre apellido_paterno apellido_materno dni telefono').limit(15).lean();
  return { clientes: clientes.map(c => ({ id: String(c._id), nombre: nombre(c), dni: c.dni, telefono: c.telefono })) };
}

function telefonoWhatsApp(value) {
  let phone = String(value || '').replace(/[\s()+.-]/g, '');
  if (/^9\d{8}$/.test(phone)) phone = '51' + phone;
  if (!/^[1-9]\d{9,14}$/.test(phone)) throw invalid('El cliente no tiene un teléfono válido. Actualízalo en Clientes (móvil peruano de 9 dígitos o número con código de país).');
  return phone;
}

async function prepararMensaje({ cliente_id, motivo = 'general', mensaje } = {}) {
  if (!mongoose.isObjectIdOrHexString(cliente_id)) throw invalid('Selecciona un cliente válido.');
  if (!['general', 'pago', 'renovacion', 'inasistencia'].includes(motivo)) throw invalid('Motivo de mensaje inválido.');
  if (mensaje !== undefined && (typeof mensaje !== 'string' || !mensaje.trim() || mensaje.length > 1500)) throw invalid('El mensaje debe tener entre 1 y 1500 caracteres.');
  const cliente = await Cliente.findById(cliente_id).lean();
  if (!cliente || !cliente.activo) throw invalid('Cliente no encontrado o inactivo.');
  const telefono = telefonoWhatsApp(cliente.telefono);
  let texto = mensaje?.trim();
  if (!texto) {
    const saludo = `Hola ${cliente.nombre}, te escribimos de PeruGym.`;
    if (motivo === 'pago') {
      const debts = (await ReportesService.balances()).filter(d => d.clienteId === String(cliente._id));
      const saldo = debts.reduce((sum, d) => sum + d.saldo, 0);
      if (saldo <= 0) throw invalid('El cliente no tiene saldo pendiente registrado. Puedes preparar un mensaje general.');
      texto = `${saludo} Tienes un saldo pendiente registrado de ${money(saldo)}. ¿Podemos ayudarte a coordinar tu abono? Si ya realizaste el pago, envíanos tu comprobante para revisarlo. ¡Gracias!`;
    } else if (motivo === 'renovacion') {
      const mem = await Membresia.findOne({ cliente_id, estado: { $in: ['activo', 'vencido'] } }).sort({ fecha_fin: -1 }).populate('plan_id', 'nombre').lean();
      if (!mem) throw invalid('No encontramos una membresía para preparar el recordatorio de renovación.');
      texto = `${saludo} Tu membresía ${mem.plan_id?.nombre || ''} ${mem.fecha_fin < new Date() ? 'venció' : 'vence'} el ${mem.fecha_fin.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}. ¿Te ayudamos con tu renovación?`;
    } else if (motivo === 'inasistencia') {
      texto = `${saludo} ¿Cómo vas con tus entrenamientos? Nos gustaría saber si necesitas apoyo para retomar tu rutina. Estamos para ayudarte.`;
    } else texto = `${saludo} ¿En qué podemos ayudarte con tu entrenamiento o membresía?`;
  }
  return { respuesta: 'Mensaje preparado. Puedes editarlo y abrir WhatsApp para enviarlo al cliente.',
    acciones: [{ tipo: 'mensaje', cliente_id: String(cliente._id), nombre: nombre(cliente), telefono, mensaje: texto }] };
}

module.exports = { generarReporte, recomendaciones, buscarClientes, prepararMensaje, telefonoWhatsApp, rango };
