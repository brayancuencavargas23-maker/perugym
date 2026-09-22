const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const Pago = require('../models/Pago');
const Asistencia = require('../models/Asistencia');
const Plan = require('../models/Plan');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const Caja = require('../models/Caja');
const MovimientoCaja = require('../models/MovimientoCaja');
const Solicitud = require('../models/Solicitud');
const MembresiaService = require('../services/MembresiaService');

// Helper RENIEC
async function consultarReniec(dni) {
  const apiUrl = process.env.RENIEC_API_URL;
  const token = process.env.RENIEC_API_TOKEN;
  if (!apiUrl || !token || !/^\d{8}$/.test(dni)) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${apiUrl}?numero=${encodeURIComponent(dni)}`, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Funciones autorizadas para el agente IA.
 * Incluye LECTURA, PREVIEW y ESCRITURA.
 */

async function buscar_cliente({ nombre, dni }) {
  const filtro = { activo: true };

  if (dni) {
    filtro.dni = dni;
  } else if (nombre) {
    filtro.$or = [
      { nombre: { $regex: nombre, $options: 'i' } },
      { apellido_paterno: { $regex: nombre, $options: 'i' } },
      { apellido_materno: { $regex: nombre, $options: 'i' } },
    ];
  }

  const clientes = await Cliente.find(filtro).limit(10).lean();

  const resultados = await Promise.all(clientes.map(async (c) => {
    const membresia = await Membresia.findOne({ cliente_id: c._id, estado: 'activo' })
      .populate('plan_id', 'nombre precio')
      .lean();

    return {
      id: c._id,
      nombre_completo: [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' '),
      dni: c.dni,
      telefono: c.telefono,
      email: c.email,
      membresia_actual: membresia ? {
        plan: membresia.plan_id?.nombre,
        precio: membresia.plan_id?.precio,
        fecha_fin: membresia.fecha_fin,
        estado: membresia.estado,
      } : null,
    };
  }));

  return { clientes: resultados, total: resultados.length };
}

async function obtener_membresias({ cliente_id, estado }) {
  const filtro = {};
  if (cliente_id) filtro.cliente_id = cliente_id;
  if (estado) filtro.estado = estado;

  const membresias = await Membresia.find(filtro)
    .populate('plan_id', 'nombre precio duracion_dias')
    .populate('cliente_id', 'nombre apellido_paterno apellido_materno dni')
    .sort({ fecha_fin: -1 })
    .limit(20)
    .lean();

  return {
    membresias: membresias.map(m => ({
      id: m._id,
      cliente: m.cliente_id ? [m.cliente_id.nombre, m.cliente_id.apellido_paterno, m.cliente_id.apellido_materno].filter(Boolean).join(' ') : 'N/A',
      dni: m.cliente_id?.dni,
      plan: m.plan_id?.nombre,
      precio: m.plan_id?.precio,
      fecha_inicio: m.fecha_inicio,
      fecha_fin: m.fecha_fin,
      estado: m.estado,
      monto_total: m.monto_total,
    })),
    total: membresias.length,
  };
}

async function listar_vencidas() {
  const membresias = await Membresia.find({ estado: 'vencido' })
    .populate('plan_id', 'nombre')
    .populate('cliente_id', 'nombre apellido_paterno apellido_materno dni telefono')
    .sort({ fecha_fin: -1 })
    .lean();

  return {
    membresias: membresias.map(m => ({
      cliente: m.cliente_id ? [m.cliente_id.nombre, m.cliente_id.apellido_paterno, m.cliente_id.apellido_materno].filter(Boolean).join(' ') : 'N/A',
      dni: m.cliente_id?.dni,
      telefono: m.cliente_id?.telefono,
      plan: m.plan_id?.nombre,
      fecha_fin: m.fecha_fin,
    })),
    total: membresias.length,
  };
}

async function proximas_a_vencer({ dias = 7 } = {}) {
  const hoy = new Date();
  const limite = new Date();
  limite.setDate(hoy.getDate() + dias);

  const membresias = await Membresia.find({
    estado: 'activo',
    fecha_fin: { $gte: hoy, $lte: limite },
  })
    .populate('plan_id', 'nombre')
    .populate('cliente_id', 'nombre apellido_paterno apellido_materno dni telefono')
    .sort({ fecha_fin: 1 })
    .lean();

  return {
    membresias: membresias.map(m => ({
      cliente: m.cliente_id ? [m.cliente_id.nombre, m.cliente_id.apellido_paterno, m.cliente_id.apellido_materno].filter(Boolean).join(' ') : 'N/A',
      dni: m.cliente_id?.dni,
      telefono: m.cliente_id?.telefono,
      plan: m.plan_id?.nombre,
      fecha_fin: m.fecha_fin,
      dias_restantes: Math.ceil((new Date(m.fecha_fin) - hoy) / (1000 * 60 * 60 * 24)),
    })),
    total: membresias.length,
    periodo: `${dias} días`,
  };
}

async function historial_pagos({ cliente_id }) {
  const pagos = await Pago.find({ cliente_id })
    .populate('membresia_id', 'estado')
    .sort({ fecha_pago: -1 })
    .limit(20)
    .lean();

  return {
    pagos: pagos.map(p => ({
      id: p._id,
      fecha: p.fecha_pago,
      monto: p.monto,
      metodo: p.metodo_pago,
      estado: p.estado,
      es_abono: p.es_abono,
      numero_abono: p.numero_abono,
    })),
    total: pagos.length,
  };
}

async function estado_pago({ membresia_id }) {
  const pagos = await Pago.find({ membresia_id }).lean();

  const total_pagado = pagos
    .filter(p => p.estado === 'pagado')
    .reduce((sum, p) => sum + p.monto, 0);

  const membresia = await Membresia.findById(membresia_id)
    .populate('plan_id', 'precio')
    .lean();

  const total_esperado = membresia?.monto_total || membresia?.plan_id?.precio || 0;

  return {
    total_pagado,
    total_esperado,
    saldo: total_esperado - total_pagado,
    cantidad_pagos: pagos.length,
    abonos: pagos.filter(p => p.es_abono).map(p => ({
      fecha: p.fecha_pago,
      monto: p.monto,
      numero: p.numero_abono,
    })),
  };
}

async function asistencia_cliente({ cliente_id, fecha_inicio, fecha_fin }) {
  const filtro = { cliente_id };
  if (fecha_inicio || fecha_fin) {
    filtro.fecha = {};
    if (fecha_inicio) filtro.fecha.$gte = new Date(fecha_inicio);
    if (fecha_fin) filtro.fecha.$lte = new Date(fecha_fin);
  }

  const registros = await Asistencia.find(filtro)
    .sort({ fecha: -1 })
    .limit(30)
    .lean();

  return {
    registros: registros.map(r => ({
      fecha: r.fecha,
      entrada: r.entrada,
      salida: r.salida,
      duracion_minutos: r.salida
        ? Math.round((new Date(r.salida) - new Date(r.entrada)) / 60000)
        : null,
    })),
    total: registros.length,
  };
}

async function aforo_actual() {
  const presentes = await Asistencia.find({ salida: null })
    .populate('cliente_id', 'nombre apellido_paterno apellido_materno dni')
    .lean();

  return {
    total: presentes.length,
    socios: presentes.map(a => ({
      nombre: a.cliente_id
        ? [a.cliente_id.nombre, a.cliente_id.apellido_paterno, a.cliente_id.apellido_materno].filter(Boolean).join(' ')
        : 'N/A',
      dni: a.cliente_id?.dni,
      entrada: a.entrada,
    })),
  };
}

async function estadisticas_generales() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

  const [sociosActivos, membresiasVencidas, asistenciasHoy, pagosMes] = await Promise.all([
    Cliente.countDocuments({ activo: true }),
    Membresia.countDocuments({ estado: 'vencido' }),
    Asistencia.countDocuments({ fecha: hoy }),
    Pago.find({ fecha_pago: { $gte: hoy, $lte: finMes }, estado: 'pagado' })
      .then(pagos => pagos.reduce((sum, p) => sum + p.monto, 0)),
  ]);

  return {
    socios_activos: sociosActivos,
    membresias_vencidas: membresiasVencidas,
    asistencias_hoy: asistenciasHoy,
    ingresos_mes: pagosMes,
    fecha_consulta: hoy,
  };
}

async function top_clientes({ limite = 10 } = {}) {
  const hace7dias = new Date();
  hace7dias.setDate(hace7dias.getDate() - 7);

  const resultado = await Asistencia.aggregate([
    { $match: { fecha: { $gte: hace7dias } } },
    { $group: { _id: '$cliente_id', visitas: { $sum: 1 } } },
    { $sort: { visitas: -1 } },
    { $limit: limite },
    { $lookup: { from: 'clientes', localField: '_id', foreignField: '_id', as: 'cliente' } },
    { $unwind: '$cliente' },
    { $project: {
      _id: 0,
      cliente_id: '$_id',
      nombre: { $concat: ['$cliente.nombre', ' ', { $ifNull: ['$cliente.apellido_paterno', ''] }] },
      visitas: 1,
    }},
  ]);

  return { top_clientes: resultado, periodo: 'últimos 7 días' };
}

// ── PRODUCTOS ────────────────────────────────────────────────────────────────

async function listar_productos({ busqueda, categoria } = {}) {
  const filtro = { activo: true };
  if (busqueda) {
    filtro.$or = [
      { nombre: { $regex: busqueda, $options: 'i' } },
      { descripcion: { $regex: busqueda, $options: 'i' } },
    ];
  }
  if (categoria) filtro.categoria = categoria;

  const productos = await Producto.find(filtro)
    .sort({ nombre: 1 })
    .limit(20)
    .lean();

  return {
    productos: productos.map(p => ({
      id: p._id,
      nombre: p.nombre,
      categoria: p.categoria,
      precio: p.precio_venta,
      stock: p.stock,
      descripcion: p.descripcion,
    })),
    total: productos.length,
  };
}

async function listar_categorias() {
  const categorias = await Producto.distinct('categoria', { activo: true, categoria: { $ne: null } });
  return { categorias: categorias.sort(), total: categorias.length };
}

async function listar_productos_bajo_stock({ limite = 5 } = {}) {
  const productos = await Producto.find({ activo: true, stock: { $lte: limite } })
    .sort({ stock: 1 })
    .limit(20)
    .lean();

  return {
    productos: productos.map(p => ({
      nombre: p.nombre,
      categoria: p.categoria,
      stock: p.stock,
      precio: p.precio_venta,
    })),
    total: productos.length,
  };
}

// ── CAJA ─────────────────────────────────────────────────────────────────────

async function caja_estado() {
  const caja = await Caja.findOne({ estado: 'abierta' })
    .populate('usuario_id', 'usuario')
    .lean();

  if (!caja) return { abierta: false, mensaje: 'No hay caja abierta actualmente.' };

  const ingresos = await MovimientoCaja.find({ caja_id: caja._id, tipo: 'ingreso' })
    .then(movs => movs.reduce((sum, m) => sum + m.monto, 0));

  const egresos = await MovimientoCaja.find({ caja_id: caja._id, tipo: 'egreso' })
    .then(movs => movs.reduce((sum, m) => sum + m.monto, 0));

  return {
    abierta: true,
    caja_id: caja._id,
    apertura: caja.apertura,
    monto_inicial: caja.monto_inicial,
    usuario: caja.usuario_id?.usuario,
    total_ingresos: ingresos,
    total_egresos: egresos,
    balance: caja.monto_inicial + ingresos - egresos,
  };
}

async function caja_resumen({ fecha } = {}) {
  const fechaBusqueda = fecha ? new Date(fecha) : new Date();
  fechaBusqueda.setHours(0, 0, 0, 0);
  const finDia = new Date(fechaBusqueda);
  finDia.setDate(finDia.getDate() + 1);

  const cajas = await Caja.find({
    apertura: { $gte: fechaBusqueda, $lt: finDia },
  }).populate('usuario_id', 'usuario').lean();

  const resumenes = await Promise.all(cajas.map(async (c) => {
    const ingresos = await MovimientoCaja.find({ caja_id: c._id, tipo: 'ingreso' })
      .then(movs => movs.reduce((sum, m) => sum + m.monto, 0));
    const egresos = await MovimientoCaja.find({ caja_id: c._id, tipo: 'egreso' })
      .then(movs => movs.reduce((sum, m) => sum + m.monto, 0));

    return {
      caja_id: c._id,
      estado: c.estado,
      apertura: c.apertura,
      cierre: c.cierre,
      monto_inicial: c.monto_inicial,
      ingresos,
      egresos,
      balance: c.monto_inicial + ingresos - egresos,
      usuario: c.usuario_id?.usuario,
    };
  }));

  return { cajas: resumenes, fecha: fechaBusqueda, total: resumenes.length };
}

async function movimientos_caja({ caja_id } = {}) {
  let cajaId = caja_id;
  if (!cajaId) {
    const cajaAbierta = await Caja.findOne({ estado: 'abierta' }).lean();
    if (!cajaAbierta) return { movimientos: [], total: 0, mensaje: 'No hay caja abierta.' };
    cajaId = cajaAbierta._id;
  }

  const movimientos = await MovimientoCaja.find({ caja_id: cajaId })
    .populate('usuario_id', 'usuario')
    .sort({ fecha: -1 })
    .limit(30)
    .lean();

  return {
    movimientos: movimientos.map(m => ({
      tipo: m.tipo,
      monto: m.monto,
      concepto: m.concepto,
      metodo: m.metodo_pago,
      fecha: m.fecha,
      usuario: m.usuario_id?.usuario,
    })),
    total: movimientos.length,
  };
}

// ── PLANES ───────────────────────────────────────────────────────────────────

async function listar_planes() {
  const planes = await Plan.find({ activo: true })
    .sort({ precio: 1 })
    .lean();

  return {
    planes: planes.map(p => ({
      id: p._id,
      nombre: p.nombre,
      precio: p.precio,
      duracion_dias: p.duracion_dias,
      descripcion: p.descripcion,
      caracteristicas: p.caracteristicas,
      destacado: p.destacado,
    })),
    total: planes.length,
  };
}

// ── SOLICITUDES / LEADS ──────────────────────────────────────────────────────

async function solicitudes_stats() {
  const stats = await Solicitud.aggregate([
    { $group: { _id: '$estado', count: { $sum: 1 } } },
  ]);

  const total = stats.reduce((sum, s) => sum + s.count, 0);
  const por_estado = {};
  stats.forEach(s => { por_estado[s._id] = s.count; });

  return {
    total,
    pendientes: por_estado.pendiente || 0,
    contactados: por_estado.contactado || 0,
    convertidos: por_estado.convertido || 0,
    descartados: por_estado.descartado || 0,
  };
}

async function listar_solicitudes({ estado } = {}) {
  const filtro = {};
  if (estado) filtro.estado = estado;

  const solicitudes = await Solicitud.find(filtro)
    .populate('plan_id', 'nombre precio')
    .sort({ created_at: -1 })
    .limit(20)
    .lean();

  return {
    solicitudes: solicitudes.map(s => ({
      id: s._id,
      nombre: [s.nombre, s.apellido_paterno, s.apellido_materno].filter(Boolean).join(' '),
      dni: s.dni,
      telefono: s.telefono,
      email: s.email,
      plan: s.plan_id?.nombre,
      estado: s.estado,
      notas: s.notas,
      fecha: s.created_at,
    })),
    total: solicitudes.length,
  };
}

// ── VENTAS ───────────────────────────────────────────────────────────────────

async function ventas_hoy() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);

  const ventas = await Venta.find({
    fecha_venta: { $gte: hoy, $lt: manana },
    anulada: false,
  }).populate('cliente_id', 'nombre apellido_paterno').lean();

  const total = ventas.reduce((sum, v) =>
    sum + v.items.reduce((s, i) => s + i.subtotal, 0), 0);

  return {
    total_ventas: ventas.length,
    monto_total: total,
    ventas: ventas.map(v => ({
      cliente: v.cliente_id ? [v.cliente_id.nombre, v.cliente_id.apellido_paterno].filter(Boolean).join(' ') : 'General',
      metodo: v.metodo_pago,
      items: v.items.length,
      total: v.items.reduce((s, i) => s + i.subtotal, 0),
      fecha: v.fecha_venta,
    })),
  };
}

async function ventas_recientes({ limite = 10 } = {}) {
  const ventas = await Venta.find({ anulada: false })
    .populate('cliente_id', 'nombre apellido_paterno')
    .sort({ fecha_venta: -1 })
    .limit(limite)
    .lean();

  return {
    ventas: ventas.map(v => ({
      cliente: v.cliente_id ? [v.cliente_id.nombre, v.cliente_id.apellido_paterno].filter(Boolean).join(' ') : 'General',
      metodo: v.metodo_pago,
      items: v.items.map(i => ({
        cantidad: i.cantidad,
        subtotal: i.subtotal,
      })),
      total: v.items.reduce((s, i) => s + i.subtotal, 0),
      fecha: v.fecha_venta,
    })),
    total: ventas.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// NUEVAS FUNCIONES: RENIEC, ESCRITURA, AVANZADAS
// ══════════════════════════════════════════════════════════════════════════════

// ── RENIEC ───────────────────────────────────────────────────────────────────

async function buscar_reniec({ dni }) {
  if (!dni || !/^\d{8}$/.test(dni)) {
    return { error: 'El DNI debe tener exactamente 8 dígitos.' };
  }
  const data = await consultarReniec(dni);
  if (!data) return { error: 'DNI no encontrado en RENIEC.' };
  return {
    dni: data.document_number || dni,
    nombre: data.first_name || '',
    apellido_paterno: data.first_last_name || '',
    apellido_materno: data.second_last_name || '',
    nombre_completo: data.full_name || '',
  };
}

// ── PERFIL COMPLETO DE CLIENTE ───────────────────────────────────────────────

async function perfil_completo_cliente({ cliente_id, nombre, dni }) {
  let cliente = null;
  if (cliente_id) {
    cliente = await Cliente.findById(cliente_id).lean();
  } else if (dni) {
    cliente = await Cliente.findOne({ dni }).lean();
  } else if (nombre) {
    cliente = await Cliente.findOne({
      $or: [
        { nombre: { $regex: nombre, $options: 'i' } },
        { apellido_paterno: { $regex: nombre, $options: 'i' } },
      ],
    }).lean();
  }
  if (!cliente) return { error: 'Cliente no encontrado.' };

  const [membresia, ultimasAsistencias, pagos] = await Promise.all([
    Membresia.findOne({ cliente_id: cliente._id, estado: 'activo' })
      .populate('plan_id', 'nombre precio duracion_dias').lean(),
    Asistencia.find({ cliente_id: cliente._id }).sort({ fecha: -1 }).limit(5).lean(),
    Pago.find({ cliente_id: cliente._id }).sort({ fecha_pago: -1 }).limit(10).lean(),
  ]);

  const totalPagado = pagos.filter(p => p.estado === 'pagado').reduce((s, p) => s + p.monto, 0);
  const visitasMes = await Asistencia.countDocuments({
    cliente_id: cliente._id,
    fecha: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
  });

  return {
    cliente: {
      id: cliente._id,
      nombre: [cliente.nombre, cliente.apellido_paterno, cliente.apellido_materno].filter(Boolean).join(' '),
      dni: cliente.dni,
      telefono: cliente.telefono,
      email: cliente.email,
    },
    membresia: membresia ? {
      plan: membresia.plan_id?.nombre,
      precio: membresia.plan_id?.precio,
      fecha_inicio: membresia.fecha_inicio,
      fecha_fin: membresia.fecha_fin,
      estado: membresia.estado,
    } : null,
    pagos_recientes: pagos.map(p => ({ fecha: p.fecha_pago, monto: p.monto, metodo: p.metodo_pago })),
    total_pagado: totalPagado,
    visitas_mes: visitasMes,
    ultimas_asistencias: ultimasAsistencias.map(a => ({
      fecha: a.fecha,
      entrada: a.entrada,
      salida: a.salida,
    })),
  };
}

// ── COMPARATIVA DE PERÍODO ───────────────────────────────────────────────────

async function comparativa_periodo({ periodo = 'mes' } = {}) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let inicioActual, inicioAnterior, finAnterior;
  if (periodo === 'semana') {
    inicioActual = new Date(hoy); inicioActual.setDate(hoy.getDate() - 7);
    inicioAnterior = new Date(inicioActual); inicioAnterior.setDate(inicioActual.getDate() - 7);
    finAnterior = new Date(inicioActual);
  } else {
    inicioActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    inicioAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    finAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  }

  const [sociosActuales, sociosAnteriores, asistenciasActuales, asistenciasAnteriores, pagosActuales, pagosAnteriores] = await Promise.all([
    Cliente.countDocuments({ activo: true, created_at: { $gte: inicioActual } }),
    Cliente.countDocuments({ activo: true, created_at: { $gte: inicioAnterior, $lte: finAnterior } }),
    Asistencia.countDocuments({ fecha: { $gte: inicioActual } }),
    Asistencia.countDocuments({ fecha: { $gte: inicioAnterior, $lte: finAnterior } }),
    Pago.find({ fecha_pago: { $gte: inicioActual }, estado: 'pagado' }).then(ps => ps.reduce((s, p) => s + p.monto, 0)),
    Pago.find({ fecha_pago: { $gte: inicioAnterior, $lte: finAnterior }, estado: 'pagado' }).then(ps => ps.reduce((s, p) => s + p.monto, 0)),
  ]);

  const calc = (act, ant) => ant > 0 ? Math.round(((act - ant) / ant) * 100) : (act > 0 ? 100 : 0);

  return {
    periodo,
    actual: { socios: sociosActuales, asistencias: asistenciasActuales, ingresos: pagosActuales },
    anterior: { socios: sociosAnteriores, asistencias: asistenciasAnteriores, ingresos: pagosAnteriores },
    variacion: {
      socios: calc(sociosActuales, sociosAnteriores),
      asistencias: calc(asistenciasActuales, asistenciasAnteriores),
      ingresos: calc(pagosActuales, pagosAnteriores),
    },
  };
}

// ── INSIGHTS AUTOMÁTICOS ─────────────────────────────────────────────────────

async function insights_automaticos() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const en7dias = new Date(hoy); en7dias.setDate(hoy.getDate() + 7);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const hace7dias = new Date(hoy); hace7dias.setDate(hoy.getDate() - 7);

  const [vencenPronto, vencidas, stockBajo, nuevosSocios, topClientes, pagosHoy] = await Promise.all([
    Membresia.countDocuments({ estado: 'activo', fecha_fin: { $gte: hoy, $lte: en7dias } }),
    Membresia.countDocuments({ estado: 'vencido' }),
    Producto.countDocuments({ activo: true, stock: { $lte: 5 } }),
    Cliente.countDocuments({ created_at: { $gte: hace7dias } }),
    Asistencia.aggregate([
      { $match: { fecha: { $gte: hace7dias } } },
      { $group: { _id: '$cliente_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
      { $lookup: { from: 'clientes', localField: '_id', foreignField: '_id', as: 'cli' } },
      { $unwind: '$cli' },
      { $project: { _id: 0, nombre: '$cli.nombre', visitas: '$count' } },
    ]),
    Pago.find({ fecha_pago: { $gte: hoy }, estado: 'pagado' }).then(ps => ({
      total: ps.length,
      monto: ps.reduce((s, p) => s + p.monto, 0),
      metodos: ps.reduce((acc, p) => { acc[p.metodo_pago] = (acc[p.metodo_pago] || 0) + 1; return acc; }, {}),
    })),
  ]);

  const metodoMasUsado = Object.entries(pagosHoy.metodos).sort((a, b) => b[1] - a[1])[0];

  return {
    positivo: nuevosSocios > 0 ? `${nuevosSocios} nuevos socios esta semana` : null,
    atencion: vencenPronto > 0 ? `${vencenPronto} membresías vencen en 3 días` : null,
    vencidas: vencidas > 0 ? `${vencidas} membresías vencidas` : null,
    stock: stockBajo > 0 ? `${stockBajo} productos con stock bajo` : null,
    top_cliente: topClientes.length > 0 ? `${topClientes[0].nombre} (${topClientes[0].visitas} visitas)` : null,
    recaudacion_hoy: pagosHoy.monto > 0 ? `S/ ${pagosHoy.monto.toFixed(2)} (${pagosHoy.total} pagos)` : null,
    metodo_mas_usado: metodoMasUsado ? metodoMasUsado[0] : null,
  };
}

// ── ESCRITURA: REGISTRO DE CLIENTE ───────────────────────────────────────────

async function preparar_registro_cliente({ nombre, apellido_paterno, apellido_materno, dni, telefono, email }) {
  let nombreCompleto = nombre;
  let apePaterno = apellido_paterno;
  let apeMaterno = apellido_materno;

  if (dni && !nombre) {
    const reniec = await consultarReniec(dni);
    if (reniec) {
      nombreCompleto = reniec.first_name || nombre;
      apePaterno = reniec.first_last_name || apellido_paterno;
      apeMaterno = reniec.second_last_name || apellido_materno;
    }
  }

  if (!nombreCompleto) return { error: 'Se requiere nombre o DNI para registrar.' };

  const existente = dni ? await Cliente.findOne({ dni }).lean() : null;
  if (existente) return { error: `Ya existe un cliente con DNI ${dni}: ${[existente.nombre, existente.apellido_paterno].filter(Boolean).join(' ')}` };

  return {
    accion: 'registro_cliente',
    datos: {
      nombre: nombreCompleto,
      apellido_paterno: apePaterno || null,
      apellido_materno: apeMaterno || null,
      dni: dni || null,
      telefono: telefono || null,
      email: email || null,
    },
    preview: `📋 Registro de cliente:\n- Nombre: ${[nombreCompleto, apePaterno, apeMaterno].filter(Boolean).join(' ')}\n- DNI: ${dni || 'N/A'}\n- Teléfono: ${telefono || 'N/A'}\n- Email: ${email || 'N/A'}`,
  };
}

async function ejecutar_registro_cliente({ nombre, apellido_paterno, apellido_materno, dni, telefono, email }) {
  const cliente = await Cliente.create({
    nombre,
    apellido_paterno: apellido_paterno || null,
    apellido_materno: apellido_materno || null,
    dni: dni || null,
    telefono: telefono || null,
    email: email || null,
  });
  return {
    exito: true,
    cliente_id: cliente._id,
    mensaje: `✅ Cliente registrado: ${[cliente.nombre, cliente.apellido_paterno].filter(Boolean).join(' ')}`,
  };
}

// ── ESCRITURA: SUSCRIPCIÓN ───────────────────────────────────────────────────

async function preparar_suscripcion({ cliente_id, plan_id, metodo_pago = 'efectivo', monto, descuento = 0 }) {
  const [cliente, plan] = await Promise.all([
    Cliente.findById(cliente_id).lean(),
    Plan.findById(plan_id).lean(),
  ]);
  if (!cliente) return { error: 'Cliente no encontrado.' };
  if (!plan) return { error: 'Plan no encontrado.' };

  const descuentoAplicado = Math.min(parseFloat(descuento) || 0, plan.precio);
  const montoFinal = monto ? parseFloat(monto) : Math.max(plan.precio - descuentoAplicado, 0);
  const esAbono = montoFinal < plan.precio;
  const saldo = plan.precio - montoFinal;

  const cajaAbierta = await Caja.findOne({ estado: 'abierta' }).lean();
  if (!cajaAbierta) return { error: 'No hay caja abierta. Abre la caja primero.' };

  return {
    accion: 'suscripcion',
    datos: { cliente_id, plan_id, metodo_pago, monto: montoFinal, descuento: descuentoAplicado },
    preview: `📋 Suscripción:\n- Cliente: ${[cliente.nombre, cliente.apellido_paterno].filter(Boolean).join(' ')}\n- Plan: ${plan.nombre} (S/ ${plan.precio})\n- Método: ${metodo_pago}\n- Monto: S/ ${montoFinal.toFixed(2)}${esAbono ? `\n- Abono: S/ ${montoFinal.toFixed(2)}\n- Saldo pendiente: S/ ${saldo.toFixed(2)}` : ''}${descuentoAplicado > 0 ? `\n- Descuento: S/ ${descuentoAplicado.toFixed(2)}` : ''}`,
  };
}

async function ejecutar_suscripcion({ cliente_id, plan_id, metodo_pago = 'efectivo', monto, descuento = 0 }) {
  const cajaAbierta = await Caja.findOne({ estado: 'abierta' }).lean();
  if (!cajaAbierta) return { error: 'No hay caja abierta.' };

  const plan = await Plan.findById(plan_id).lean();
  if (!plan) return { error: 'Plan no encontrado.' };

  const descuentoAplicado = Math.min(parseFloat(descuento) || 0, plan.precio);
  const montoPlan = Math.max(plan.precio - descuentoAplicado, 0);
  const montoIngresado = monto ? parseFloat(monto) : montoPlan;
  const esAbono = montoIngresado < montoPlan;

  const membresia = await MembresiaService.crear({
    cliente_id,
    plan_id,
    fecha_inicio: new Date(),
    estado_pago: esAbono ? 'pendiente' : 'pagado',
    monto_total: montoPlan,
  });

  await Pago.create({
    cliente_id,
    membresia_id: membresia._id,
    caja_id: cajaAbierta._id,
    monto: montoIngresado,
    metodo_pago,
    estado: 'pagado',
    es_abono: esAbono,
    numero_abono: esAbono ? 1 : null,
    total_esperado: esAbono ? montoPlan : null,
  });

  return {
    exito: true,
    membresia_id: membresia._id,
    mensaje: `✅ Membresía creada: ${plan.nombre} para ${esAbono ? 'abono de S/ ' + montoIngresado.toFixed(2) : 'pago completo'}`,
  };
}

// ── ESCRITURA: PAGO/ABONO ────────────────────────────────────────────────────

async function preparar_pago({ membresia_id, monto, metodo_pago = 'efectivo' }) {
  const membresia = await Membresia.findById(membresia_id)
    .populate('plan_id', 'nombre precio')
    .populate('cliente_id', 'nombre apellido_paterno')
    .lean();
  if (!membresia) return { error: 'Membresía no encontrada.' };

  const pagos = await Pago.find({ membresia_id, estado: 'pagado' }).lean();
  const totalPagado = pagos.reduce((s, p) => s + p.monto, 0);
  const totalEsperado = membresia.monto_total || membresia.plan_id?.precio || 0;
  const saldo = totalEsperado - totalPagado;
  const montoIngresado = parseFloat(monto);

  if (montoIngresado > saldo) return { error: `El monto (S/ ${montoIngresado}) excede el saldo pendiente (S/ ${saldo.toFixed(2)})` };

  const cajaAbierta = await Caja.findOne({ estado: 'abierta' }).lean();
  if (!cajaAbierta) return { error: 'No hay caja abierta.' };

  return {
    accion: 'pago',
    datos: { membresia_id, monto: montoIngresado, metodo_pago },
    preview: `📋 Pago:\n- Cliente: ${[membresia.cliente_id?.nombre, membresia.cliente_id?.apellido_paterno].filter(Boolean).join(' ')}\n- Plan: ${membresia.plan_id?.nombre}\n- Monto: S/ ${montoIngresado.toFixed(2)}\n- Método: ${metodo_pago}\n- Saldo anterior: S/ ${saldo.toFixed(2)}\n- Saldo nuevo: S/ ${(saldo - montoIngresado).toFixed(2)}`,
  };
}

async function ejecutar_pago({ membresia_id, monto, metodo_pago = 'efectivo' }) {
  const membresia = await Membresia.findById(membresia_id).lean();
  if (!membresia) return { error: 'Membresía no encontrada.' };

  const cajaAbierta = await Caja.findOne({ estado: 'abierta' }).lean();
  if (!cajaAbierta) return { error: 'No hay caja abierta.' };

  const pagos = await Pago.find({ membresia_id, estado: 'pagado' }).lean();
  const totalPagado = pagos.reduce((s, p) => s + p.monto, 0);
  const totalEsperado = membresia.monto_total || 0;
  const saldo = totalEsperado - totalPagado;
  const montoIngresado = parseFloat(monto);

  const pago = await Pago.create({
    cliente_id: membresia.cliente_id,
    membresia_id,
    caja_id: cajaAbierta._id,
    monto: montoIngresado,
    metodo_pago,
    estado: 'pagado',
    es_abono: true,
    numero_abono: pagos.filter(p => p.es_abono).length + 1,
    total_esperado: totalEsperado,
  });

  if (totalPagado + montoIngresado >= totalEsperado) {
    await Membresia.findByIdAndUpdate(membresia_id, { estado: 'activo' });
  }

  return {
    exito: true,
    pago_id: pago._id,
    mensaje: `✅ Pago registrado: S/ ${montoIngresado.toFixed(2)} por ${metodo_pago}. Saldo: S/ ${(saldo - montoIngresado).toFixed(2)}`,
  };
}

// ── ESCRITURA: CHECK-IN / CHECK-OUT ──────────────────────────────────────────

async function ejecutar_checkin({ cliente_id }) {
  const cliente = await Cliente.findById(cliente_id).lean();
  if (!cliente) return { error: 'Cliente no encontrado.' };

  const yaPresente = await Asistencia.findOne({ cliente_id, salida: null }).lean();
  if (yaPresente) return { error: `${cliente.nombre} ya tiene check-in registrado hoy.` };

  const asistencia = await Asistencia.create({
    cliente_id,
    entrada: new Date(),
    fecha: new Date(),
  });

  return {
    exito: true,
    asistencia_id: asistencia._id,
    mensaje: `✅ Check-in registrado: ${[cliente.nombre, cliente.apellido_paterno].filter(Boolean).join(' ')}`,
  };
}

async function ejecutar_checkout({ cliente_id }) {
  const cliente = await Cliente.findById(cliente_id).lean();
  if (!cliente) return { error: 'Cliente no encontrado.' };

  const asistencia = await Asistencia.findOne({ cliente_id, salida: null }).lean();
  if (!asistencia) return { error: `${cliente.nombre} no tiene check-in activo.` };

  await Asistencia.findByIdAndUpdate(asistencia._id, { salida: new Date() });

  const duracion = Math.round((new Date() - new Date(asistencia.entrada)) / 60000);
  return {
    exito: true,
    mensaje: `✅ Check-out registrado: ${[cliente.nombre, cliente.apellido_paterno].filter(Boolean).join(' ')} (${duracion} min)`,
  };
}

// ── ESCRITURA: ESTADO DE SOLICITUD ───────────────────────────────────────────

async function preparar_estado_solicitud({ solicitud_id, estado, notas }) {
  const sol = await Solicitud.findById(solicitud_id)
    .populate('plan_id', 'nombre precio')
    .lean();
  if (!sol) return { error: 'Solicitud no encontrada.' };

  const estados = ['pendiente', 'contactado', 'convertido', 'descartado'];
  if (!estados.includes(estado)) return { error: `Estado inválido. Valores: ${estados.join(', ')}` };

  return {
    accion: 'estado_solicitud',
    datos: { solicitud_id, estado, notas },
    preview: `📋 Cambio de estado:\n- Lead: ${[sol.nombre, sol.apellido_paterno].filter(Boolean).join(' ')}\n- Estado actual: ${sol.estado}\n- Nuevo estado: ${estado}${notas ? `\n- Notas: ${notas}` : ''}`,
  };
}

async function ejecutar_estado_solicitud({ solicitud_id, estado, notas }) {
  const sol = await Solicitud.findById(solicitud_id).lean();
  if (!sol) return { error: 'Solicitud no encontrada.' };

  await Solicitud.findByIdAndUpdate(solicitud_id, {
    estado,
    notas: notas || sol.notas,
  });

  return {
    exito: true,
    mensaje: `✅ Solicitud de ${[sol.nombre, sol.apellido_paterno].filter(Boolean).join(' ')} marcada como "${estado}"`,
  };
}

// ── Definición de funciones para function calling ────────────────────────────
const FUNCTIONS_DEFINITIONS = [
  // ── LECTURA EXISTENTE ──
  { name: 'buscar_cliente', description: 'Busca clientes por nombre o DNI.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, dni: { type: 'string' } } } },
  { name: 'obtener_membresias', description: 'Obtiene membresías de un cliente o filtra por estado.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' }, estado: { type: 'string', enum: ['activo', 'vencido', 'cancelado', 'pendiente'] } } } },
  { name: 'listar_vencidas', description: 'Lista membresías vencidas.', parameters: { type: 'object', properties: {} } },
  { name: 'proximas_a_vencer', description: 'Membresías que vencen en N días.', parameters: { type: 'object', properties: { dias: { type: 'number' } } } },
  { name: 'historial_pagos', description: 'Historial de pagos de un cliente.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' } }, required: ['cliente_id'] } },
  { name: 'estado_pago', description: 'Estado de pago de una membresía.', parameters: { type: 'object', properties: { membresia_id: { type: 'string' } }, required: ['membresia_id'] } },
  { name: 'asistencia_cliente', description: 'Registros de asistencia de un cliente.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' }, fecha_inicio: { type: 'string' }, fecha_fin: { type: 'string' } }, required: ['cliente_id'] } },
  { name: 'aforo_actual', description: 'Personas actualmente en el gym.', parameters: { type: 'object', properties: {} } },
  { name: 'estadisticas_generales', description: 'Estadísticas generales del gimnasio.', parameters: { type: 'object', properties: {} } },
  { name: 'top_clientes', description: 'Clientes que más asistieron (7 días).', parameters: { type: 'object', properties: { limite: { type: 'number' } } } },
  { name: 'listar_productos', description: 'Lista productos disponibles.', parameters: { type: 'object', properties: { busqueda: { type: 'string' }, categoria: { type: 'string' } } } },
  { name: 'listar_categorias', description: 'Categorías de productos.', parameters: { type: 'object', properties: {} } },
  { name: 'listar_productos_bajo_stock', description: 'Productos con stock bajo.', parameters: { type: 'object', properties: { limite: { type: 'number' } } } },
  { name: 'caja_estado', description: 'Estado de la caja actual.', parameters: { type: 'object', properties: {} } },
  { name: 'caja_resumen', description: 'Resumen de cajas de una fecha.', parameters: { type: 'object', properties: { fecha: { type: 'string' } } } },
  { name: 'movimientos_caja', description: 'Movimientos de una caja.', parameters: { type: 'object', properties: { caja_id: { type: 'string' } } } },
  { name: 'listar_planes', description: 'Planes de membresía disponibles.', parameters: { type: 'object', properties: {} } },
  { name: 'solicitudes_stats', description: 'Estadísticas de leads.', parameters: { type: 'object', properties: {} } },
  { name: 'listar_solicitudes', description: 'Lista leads por estado.', parameters: { type: 'object', properties: { estado: { type: 'string', enum: ['pendiente', 'contactado', 'convertido', 'descartado'] } } } },
  { name: 'ventas_hoy', description: 'Resumen de ventas de hoy.', parameters: { type: 'object', properties: {} } },
  { name: 'ventas_recientes', description: 'Últimas ventas registradas.', parameters: { type: 'object', properties: { limite: { type: 'number' } } } },
  // ── LECTURA AVANZADA ──
  { name: 'buscar_reniec', description: 'Consulta DNI en RENIEC. Retorna nombre completo.', parameters: { type: 'object', properties: { dni: { type: 'string', description: 'DNI de 8 dígitos' } }, required: ['dni'] } },
  { name: 'perfil_completo_cliente', description: 'Perfil completo: datos, membresía, pagos, asistencia.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' }, nombre: { type: 'string' }, dni: { type: 'string' } } } },
  { name: 'comparativa_periodo', description: 'Compara métricas del período actual vs anterior.', parameters: { type: 'object', properties: { periodo: { type: 'string', enum: ['semana', 'mes'] } } } },
  { name: 'insights_automaticos', description: 'Análisis inteligente: alertas, tendencias, recomendaciones.', parameters: { type: 'object', properties: {} } },
  // ── ESCRITURA (PREVIEW) ──
  { name: 'preparar_registro_cliente', description: 'PREVIEW: Prepara registro de cliente. Si tiene DNI, busca en RENIEC automáticamente.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, apellido_paterno: { type: 'string' }, apellido_materno: { type: 'string' }, dni: { type: 'string' }, telefono: { type: 'string' }, email: { type: 'string' } } } },
  { name: 'preparar_suscripcion', description: 'PREVIEW: Prepara suscripción con plan, método de pago y monto.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' }, plan_id: { type: 'string' }, metodo_pago: { type: 'string', enum: ['efectivo', 'yape', 'plin', 'transferencia'] }, monto: { type: 'number' }, descuento: { type: 'number' } }, required: ['cliente_id', 'plan_id'] } },
  { name: 'preparar_pago', description: 'PREVIEW: Prepara registro de pago/abono.', parameters: { type: 'object', properties: { membresia_id: { type: 'string' }, monto: { type: 'number' }, metodo_pago: { type: 'string', enum: ['efectivo', 'yape', 'plin', 'transferencia'] } }, required: ['membresia_id', 'monto'] } },
  { name: 'preparar_estado_solicitud', description: 'PREVIEW: Prepara cambio de estado de lead.', parameters: { type: 'object', properties: { solicitud_id: { type: 'string' }, estado: { type: 'string', enum: ['pendiente', 'contactado', 'convertido', 'descartado'] }, notas: { type: 'string' } }, required: ['solicitud_id', 'estado'] } },
  // ── ESCRITURA (EJECUCIÓN) ──
  { name: 'ejecutar_registro_cliente', description: 'EJECUTAR: Crea el cliente en BD. Solo llamar después de confirmación.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, apellido_paterno: { type: 'string' }, apellido_materno: { type: 'string' }, dni: { type: 'string' }, telefono: { type: 'string' }, email: { type: 'string' } }, required: ['nombre'] } },
  { name: 'ejecutar_suscripcion', description: 'EJECUTAR: Crea membresía + pago. Requiere caja abierta.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' }, plan_id: { type: 'string' }, metodo_pago: { type: 'string' }, monto: { type: 'number' }, descuento: { type: 'number' } }, required: ['cliente_id', 'plan_id'] } },
  { name: 'ejecutar_pago', description: 'EJECUTAR: Registra pago/abono. Requiere caja abierta.', parameters: { type: 'object', properties: { membresia_id: { type: 'string' }, monto: { type: 'number' }, metodo_pago: { type: 'string' } }, required: ['membresia_id', 'monto'] } },
  { name: 'ejecutar_checkin', description: 'EJECUTAR: Registra entrada de cliente.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' } }, required: ['cliente_id'] } },
  { name: 'ejecutar_checkout', description: 'EJECUTAR: Registra salida de cliente.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' } }, required: ['cliente_id'] } },
  { name: 'ejecutar_estado_solicitud', description: 'EJECUTAR: Actualiza estado del lead.', parameters: { type: 'object', properties: { solicitud_id: { type: 'string' }, estado: { type: 'string' }, notas: { type: 'string' } }, required: ['solicitud_id', 'estado'] } },
];

// Mapa de funciones para ejecución
const FUNCTIONS_MAP = {
  buscar_cliente, obtener_membresias, listar_vencidas, proximas_a_vencer,
  historial_pagos, estado_pago, asistencia_cliente, aforo_actual,
  estadisticas_generales, top_clientes, listar_productos, listar_categorias,
  listar_productos_bajo_stock, caja_estado, caja_resumen, movimientos_caja,
  listar_planes, solicitudes_stats, listar_solicitudes, ventas_hoy, ventas_recientes,
  buscar_reniec, perfil_completo_cliente, comparativa_periodo, insights_automaticos,
  preparar_registro_cliente, ejecutar_registro_cliente,
  preparar_suscripcion, ejecutar_suscripcion,
  preparar_pago, ejecutar_pago,
  ejecutar_checkin, ejecutar_checkout,
  preparar_estado_solicitud, ejecutar_estado_solicitud,
};

module.exports = { FUNCTIONS_DEFINITIONS, FUNCTIONS_MAP };
