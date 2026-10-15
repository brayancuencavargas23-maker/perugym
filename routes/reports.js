const router = require('express').Router();
const Pago = require('../models/Pago');
const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const { presentarPago } = require('../services/MembresiaPagosService');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const Caja = require('../models/Caja');
const Compra = require('../models/Compra');
const { verifyToken, requireRole, requirePermission } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { dateFilter, period, limaDate } = require('../utils/reportDates');
const ReportesService = require('../services/ReportesService');
const ReporteSeguimiento = require('../models/ReporteSeguimiento');
const { categoriaProducto } = require('../utils/productoCategoria');

const METODO_PAGO_ORDER = ['efectivo', 'yape', 'plin', 'transferencia'];
const methodLabel = m => ({ efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia' }[m]
  || String(m || 'sin método').replace(/^\w/, c => c.toUpperCase()));
const sortMethods = methods => Object.entries(methods).sort((a, b) => {
  const ia = METODO_PAGO_ORDER.indexOf(a[0]), ib = METODO_PAGO_ORDER.indexOf(b[0]);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return b[1] - a[1];
});

router.use(verifyToken, requireRole('admin', 'recepcionista'));
router.use((req, res, next) => {
  try { dateFilter(req.query.from, req.query.to); next(); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/analytics', async (req, res) => {
  try {
    period(req.query);
    if (req.query.inactiveDays && !['7', '14', '30'].includes(req.query.inactiveDays)) return res.status(400).json({ error: 'Umbral inválido.' });
  } catch (err) { return res.status(400).json({ error: err.message }); }
  try { res.set('Cache-Control', 'no-store').json(await ReportesService.analytics(req.query)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/seguimiento', async (req, res) => {
  const { clave, estado } = req.body;
  if (typeof clave !== 'string' || !/^(saldo|vencimiento|inasistencia):[a-f0-9]{24}(:\d{4}-\d{2}-\d{2})?$/.test(clave) || !['pendiente', 'contactado', 'resuelto'].includes(estado)) {
    return res.status(400).json({ error: 'Seguimiento inválido.' });
  }
  try {
    const row = await ReporteSeguimiento.findOneAndUpdate({ clave }, { estado, responsable: String(req.user.name || req.user.email || req.user.id), actualizado: new Date() }, { upsert: true, returnDocument: 'after', runValidators: true });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/analytics/excel', async (req, res) => {
  try {
    period(req.query);
    if (req.query.inactiveDays && !['7', '14', '30'].includes(req.query.inactiveDays)) throw new Error('Umbral inválido.');
  } catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const data = await ReportesService.analytics(req.query);
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet('Resumen');
    summary.addRows([['PeruGym — Reportes y análisis'], ['Período', data.periodo.from, data.periodo.to], ['Comparación', data.periodo.previousFrom, data.periodo.previousTo],
      ['Generado', data.actualizado.toISOString()], ['Ingresos cobrados', data.stats.ingresos], ['Ingresos anteriores', data.stats.anterior],
      ['Clientes vigentes hoy', data.stats.activos], ['Nuevos clientes de pago', data.stats.nuevos], ['Renovación (%) — ventana 7 días', data.stats.renovacion ?? 'Sin base'],
      ['Oportunidades evaluadas', data.stats.elegibles], ['Saldo actual por cobrar', data.stats.saldo], ['Clientes sin asistencia reciente', data.stats.inactivos], ['Egresos registrados', data.stats.egresos]]);
    const sheets = [
      ['Ingresos diarios', ['Fecha', 'Cobrado', 'Fecha comparable', 'Anterior', 'Altas', 'Renovaciones'], data.daily.map(d => [d.fecha, d.actual, d.anteriorFecha, d.anterior, d.altas, d.renovaciones])],
      ['Métodos de pago', ['Método', 'Cobrado (S/)', '% del total'], (() => {
        const total = Object.values(data.methods).reduce((s, n) => s + n, 0);
        return sortMethods(data.methods).map(([m, n]) => [methodLabel(m), n, total ? Math.round(n / total * 1000) / 10 : 0]);
      })()],
      ['Saldos actuales', ['Cliente', 'Plan', 'Acordado', 'Pagado', 'Saldo'], data.debts.map(d => [d.nombre, d.plan, d.acordado, d.pagado, d.saldo])],
      ['Productos', ['Producto', 'Stock actual', 'Unidades vendidas', 'Ingresos', 'Días estimados de stock'], data.products.map(d => [d.nombre, d.stock, d.unidades, d.ingresos, d.diasStock ?? 'Sin ventas'])],
      ['Seguimiento', ['Cliente', 'Tipo', 'Motivo', 'Acción', 'Estado', 'Responsable'], data.recommendations.map(d => [d.nombre, d.tipo, d.motivo, d.accion, d.seguimiento.estado, d.seguimiento.responsable || '-'])],
      ['Renovaciones', ['Cliente', 'Plan', 'Vencimiento', 'Resultado'], data.renewals.map(d => [d.nombre, d.plan, d.fecha, d.resultado])],
      ['Clientes vigentes', ['Cliente', 'Plan', 'Inicio', 'Fin'], data.activeClients.map(d => [d.nombre, d.plan, d.inicio, d.fin])],
      ['Nuevos clientes', ['Cliente', 'Primer pago'], data.newClients.map(d => [d.nombre, d.fecha])],
      ['Afluencia', ['Día (lunes=1)', 'Hora Lima', 'Entradas'], data.heatmap.flatMap((hours, day) => hours.map((n, hour) => [day + 1, hour, n]))]
    ];
    for (const [name, headers, rows] of sheets) { const ws = wb.addWorksheet(name); ws.addRow(headers); ws.addRows(rows); ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } }; }
    wb.eachSheet(ws => { ws.columns.forEach(c => { c.width = 28; }); ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="analisis.xlsx"');
    res.end(await wb.xlsx.writeBuffer());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: construye workbook con estilo empresarial PeruGym
// ─────────────────────────────────────────────────────────────────────────────
function buildStyledWorkbook(titulo, sheetName, headers, rows, extraInfo) {
  const LOGO_PATH = path.join(__dirname, '..', 'public', 'imagenes', 'index', 'WhatsApp Image 2026-04-12 at 7.00.32 PM.png');
  const RED_DARK  = 'FF7B2D2D';
  const RED_MID   = 'FFA0522D';
  const WHITE     = 'FFFFFFFF';
  const PEACH     = 'FFFFC9A0';
  const GRAY_BG   = 'FFF1F5F9';
  const ROW_EVEN  = 'FFF8FAFC';
  const ROW_ODD   = 'FFFFFFFF';
  const TEXT_DARK = 'FF374151';

  const colCount = headers.length;
  const lastCol  = String.fromCharCode(64 + colCount);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PeruGym Sistema';
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
  });

  if (colCount < 4) {
    ws.addRow([titulo]);
    ws.addRow([extraInfo || 'PeruGym']);
    ws.addRow(headers.map(h => h.header));
    rows.forEach(r => ws.addRow(headers.map(h => r[h.key] ?? '-')));
    ws.columns.forEach((c, i) => { c.width = headers[i].width || 30; });
    ws.getRow(1).font = { bold: true, size: 14 };
    return wb;
  }

  ws.columns = headers.map(h => ({ key: h.key, width: h.width }));

  ws.getRow(1).height = 70;
  ws.getRow(2).height = 22;
  ws.getRow(3).height = 18;
  ws.getRow(4).height = 5;
  ws.getRow(5).height = 22;

  // Fila 1: banda roja + logo + título
  ws.mergeCells('A1:' + lastCol + '1');
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };
  ws.getCell('A1').value = '     ' + titulo;
  ws.getCell('A1').font  = { name: 'Calibri', size: 14, bold: true, color: { argb: WHITE } };
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 8 };

  try {
    if (fs.existsSync(LOGO_PATH)) {
      const logoBuffer = fs.readFileSync(LOGO_PATH);
      const logoId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
      ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 95, height: 92 }, editAs: 'oneCell' });
    }
  } catch (_) {
    // Logo no disponible en este entorno, se omite sin afectar el archivo
  }

  // Fila 2: subtítulo
  ws.mergeCells('A2:' + lastCol + '2');
  ws.getCell('A2').value = extraInfo || 'PeruGym - Centro de Entrenamiento y Fitness';
  ws.getCell('A2').font  = { name: 'Calibri', size: 9, italic: true, color: { argb: PEACH } };
  ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 9 };
  ws.getCell('A2').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };

  // Fila 3: metadatos
  for (let c = 1; c <= colCount; c++) {
    ws.getCell(3, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } };
  }
  ws.getCell('A3').value = 'Sistema:';
  ws.getCell('A3').font  = { bold: true, color: { argb: RED_DARK }, size: 9 };
  ws.getCell('A3').alignment = { indent: 1 };

  const midCol  = String.fromCharCode(65 + Math.floor(colCount / 2) - 1);
  const midCol2 = String.fromCharCode(65 + Math.floor(colCount / 2));
  ws.mergeCells('B3:' + midCol + '3');
  ws.getCell('B3').value = 'PeruGym v1.0';
  ws.getCell('B3').font  = { size: 9, color: { argb: TEXT_DARK } };
  ws.getCell(midCol2 + '3').value = 'Generado:';
  ws.getCell(midCol2 + '3').font  = { bold: true, color: { argb: RED_DARK }, size: 9 };

  const afterMid = String.fromCharCode(65 + Math.floor(colCount / 2) + 1);
  if (afterMid <= lastCol) ws.mergeCells(afterMid + '3:' + lastCol + '3');
  ws.getCell(afterMid + '3').value = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });
  ws.getCell(afterMid + '3').font  = { size: 9, color: { argb: TEXT_DARK } };

  // Fila 4: separador
  ws.mergeCells('A4:' + lastCol + '4');
  ws.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_MID } };

  // Fila 5: encabezados de tabla
  headers.forEach((h, idx) => {
    const cell = ws.getCell(5, idx + 1);
    cell.value = h.header;
    cell.font  = { name: 'Calibri', size: 11, bold: true, color: { argb: WHITE } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top:    { style: 'thin', color: { argb: RED_MID } },
      bottom: { style: 'thin', color: { argb: RED_MID } },
      left:   { style: 'thin', color: { argb: RED_MID } },
      right:  { style: 'thin', color: { argb: RED_MID } }
    };
  });

  // Filas de datos desde fila 6
  rows.forEach((r, i) => {
    const rowNum = 6 + i;
    ws.getRow(rowNum).height = 18;
    const bgColor = i % 2 === 0 ? ROW_EVEN : ROW_ODD;

    headers.forEach((h, idx) => {
      const cell = ws.getCell(rowNum, idx + 1);
      let val = r[h.key];
      if (val === null || val === undefined) val = '-';
      if (val instanceof Date) val = val.toLocaleString('es-PE', { timeZone: 'America/Lima' });

      cell.value = h.key === '_num' ? i + 1 : val;
      cell.font  = { name: 'Calibri', size: 10 };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: (idx <= 1 || h.align === 'left') ? 'left' : (h.align || 'center')
      };
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        right:  { style: 'hair', color: { argb: 'FFE2E8F0' } }
      };

      if (h.colorFn) {
        const color = h.colorFn(val, r);
        if (color) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: color } };
      }
    });
  });

  // Fila total
  const totalRowNum = 6 + rows.length;
  ws.mergeCells('A' + totalRowNum + ':' + lastCol + totalRowNum);
  const totalCell = ws.getCell('A' + totalRowNum);
  totalCell.value = 'Total de registros: ' + rows.length;
  totalCell.font  = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
  totalCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };
  totalCell.alignment = { vertical: 'middle', horizontal: 'right' };
  ws.getRow(totalRowNum).height = 20;

  ws.headerFooter.oddFooter = '&LPeruGym - Sistema de Gestion&C&"Calibri,Italic"Reporte generado automaticamente&RPagina &P de &N';

  return wb;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGOS Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pagos/excel', async (req, res) => {
  const { from, to, estado, metodo_pago } = req.query;
  try {
    const filter = {};
    if (estado)      filter.estado = estado;
    if (metodo_pago) filter.metodo_pago = metodo_pago;
    if (from || to) {
      filter.fecha_pago = dateFilter(from, to);
    }

    const pagos = await Pago.find(filter)
      .populate('cliente_id', 'nombre')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
      .sort({ fecha_pago: -1 })
      .lean();

    const rows = pagos.map(p => ({
      _num:        null,
      cliente:     p.cliente_id?.nombre || '-',
      plan:        presentarPago(p).plan_nombre || '-',
      monto:       p.monto,
      metodo_pago: p.metodo_pago,
      fecha_pago:  p.fecha_pago,
      estado:      p.estado,
      notas:       p.notas || '-',
    }));

    const totalMonto = rows.filter(r => r.estado === 'pagado').reduce((s, r) => s + parseFloat(r.monto || 0), 0);
    const extra = from && to
      ? `PeruGym - Período: ${from} al ${to}  |  Total recaudado: S/ ${totalMonto.toFixed(2)}`
      : `PeruGym - Centro de Entrenamiento y Fitness  |  Total recaudado: S/ ${totalMonto.toFixed(2)}`;

    const headers = [
      { header: '#',       key: '_num',       width: 8  },
      { header: 'Cliente', key: 'cliente',    width: 26, align: 'left' },
      { header: 'Plan',    key: 'plan',       width: 22 },
      { header: 'Monto',   key: 'monto',      width: 14, colorFn: () => 'FF16A34A' },
      { header: 'Método',  key: 'metodo_pago',width: 16 },
      { header: 'Fecha',   key: 'fecha_pago', width: 20 },
      { header: 'Estado',  key: 'estado',     width: 14, colorFn: v => v === 'pagado' ? 'FF16A34A' : v === 'pendiente' ? 'FFA16207' : 'FFCC0000' },
      { header: 'Notas',   key: 'notas',      width: 32, align: 'left' },
    ];

    const wb = buildStyledWorkbook('REPORTE DE PAGOS', 'Pagos', headers, rows, extra);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="pagos.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTES Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/clientes/excel', async (req, res) => {
  try {
    const clientes = await Cliente.find().sort({ nombre: 1 }).lean();

    const rows = await Promise.all(clientes.map(async (c) => {
      const mem = await Membresia.findOne({ cliente_id: c._id })
        .populate('plan_id', 'nombre')
        .sort({ fecha_fin: -1 })
        .lean();
      return {
        _num:             null,
        nombre:           c.nombre,
        dni:              c.dni || '-',
        email:            c.email || '-',
        telefono:         c.telefono || '-',
        plan:             mem?.plan_id?.nombre || '-',
        fecha_fin:        mem?.fecha_fin || null,
        membresia_estado: mem?.estado || '-',
        estado:           c.activo ? 'Activo' : 'Inactivo',
      };
    }));

    const headers = [
      { header: '#',           key: '_num',             width: 8  },
      { header: 'Nombre',      key: 'nombre',           width: 26, align: 'left' },
      { header: 'DNI',         key: 'dni',              width: 14 },
      { header: 'Email',       key: 'email',            width: 28, align: 'left' },
      { header: 'Teléfono',    key: 'telefono',         width: 16 },
      { header: 'Plan',        key: 'plan',             width: 22 },
      { header: 'Vencimiento', key: 'fecha_fin',        width: 16 },
      { header: 'Membresía',   key: 'membresia_estado', width: 14, colorFn: v => v === 'activo' ? 'FF16A34A' : v === 'vencido' ? 'FFCC0000' : 'FFA16207' },
      { header: 'Estado',      key: 'estado',           width: 12, colorFn: v => v === 'Activo' ? 'FF16A34A' : 'FFCC0000' },
    ];

    const wb = buildStyledWorkbook('REPORTE DE CLIENTES', 'Clientes', headers, rows, 'PeruGym - Centro de Entrenamiento y Fitness');
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ASISTENCIA Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/asistencia/excel', async (req, res) => {
  const { from, to } = req.query;
  try {
    const filter = {};
    if (from || to) {
      filter.entrada = dateFilter(from, to);
    }

    const asistencias = await require('../models/Asistencia').find(filter)
      .populate('cliente_id', 'nombre')
      .sort({ fecha: -1, entrada: -1 })
      .lean();

    const rows = asistencias.map(a => {
      const entrada = a.entrada ? a.entrada.toLocaleTimeString('es-PE', { timeZone: 'America/Lima' }) : '-';
      const salida  = a.salida ? a.salida.toLocaleTimeString('es-PE', { timeZone: 'America/Lima' }) : '-';
      let duracion = 'En curso';
      if (a.salida) {
        const secs = Math.round((a.salida - a.entrada) / 1000);
        duracion = secs < 60 ? `${secs} seg` : `${Math.round(secs / 60)} min`;
      }
      return {
        _num:    null,
        cliente: a.cliente_id?.nombre || '-',
        fecha: limaDate(a.entrada),
        entrada,
        salida,
        duracion,
      };
    });

    const extra = from && to
      ? `PeruGym - Período: ${from} al ${to}`
      : 'PeruGym - Centro de Entrenamiento y Fitness';

    const headers = [
      { header: '#',        key: '_num',    width: 10 },
      { header: 'Cliente',  key: 'cliente', width: 28, align: 'left' },
      { header: 'Fecha',    key: 'fecha',   width: 16 },
      { header: 'Entrada',  key: 'entrada', width: 14 },
      { header: 'Salida',   key: 'salida',  width: 14 },
      { header: 'Duración', key: 'duracion',width: 16, colorFn: v => v === 'En curso' ? 'FF6B2020' : v && v.includes('seg') ? 'FFA16207' : 'FF16A34A' },
    ];

    const wb = buildStyledWorkbook('REPORTE CONSOLIDADO DE ASISTENCIAS', 'Asistencias', headers, rows, extra);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="asistencias.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MEMBRESÍAS Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/membresias/excel', async (req, res) => {
  const { estado, vencen_pronto } = req.query;
  try {
    const filter = {};
    if (estado) filter.estado = estado;
    if (vencen_pronto === 'true') {
      const now = new Date();
      const in7 = new Date(); in7.setDate(in7.getDate() + 7);
      filter.fecha_fin = { $gte: now, $lte: in7 };
      filter.estado = 'activo';
    }

    const mems = await Membresia.find(filter)
      .populate('cliente_id', 'nombre dni telefono email')
      .populate('plan_id', 'nombre')
      .sort({ fecha_fin: 1 })
      .lean();

    const now = new Date();
    const rows = mems.map(m => ({
      _num:           null,
      cliente:        m.cliente_id?.nombre || '-',
      dni:            m.cliente_id?.dni || '-',
      telefono:       m.cliente_id?.telefono || '-',
      email:          m.cliente_id?.email || '-',
      plan:           m.plan_id?.nombre || '-',
      fecha_inicio:   m.fecha_inicio,
      fecha_fin:      m.fecha_fin,
      estado:         m.estado,
      dias_restantes: m.fecha_fin ? Math.ceil((m.fecha_fin - now) / 86400000) : '-',
    }));

    const headers = [
      { header: '#',               key: '_num',          width: 8  },
      { header: 'Cliente',         key: 'cliente',       width: 26, align: 'left' },
      { header: 'DNI',             key: 'dni',           width: 14 },
      { header: 'Teléfono',        key: 'telefono',      width: 16 },
      { header: 'Email',           key: 'email',         width: 28, align: 'left' },
      { header: 'Plan',            key: 'plan',          width: 22 },
      { header: 'Fecha Inicio',    key: 'fecha_inicio',  width: 16 },
      { header: 'Fecha Fin',       key: 'fecha_fin',     width: 16 },
      { header: 'Estado',          key: 'estado',        width: 14, colorFn: v => v === 'activo' ? 'FF16A34A' : v === 'vencido' ? 'FFCC0000' : 'FFA16207' },
      { header: 'Días Restantes',  key: 'dias_restantes',width: 16, colorFn: v => { const n = parseInt(v); if (isNaN(n) || n < 0) return 'FFCC0000'; if (n <= 7) return 'FFA16207'; return 'FF16A34A'; } },
    ];

    const wb = buildStyledWorkbook('REPORTE DE MEMBRESÍAS', 'Membresías', headers, rows, 'PeruGym - Centro de Entrenamiento y Fitness');
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="membresias.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGOS PENDIENTES Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pagos-pendientes/excel', async (req, res) => {
  try {
    const pagos = await ReportesService.balances();

    const rows = pagos.map(p => ({
      _num:      null,
      cliente: p.nombre,
      dni: p.dni,
      telefono: p.telefono,
      email: p.email,
      plan: p.plan,
      monto: p.saldo,
      fecha_pago: p.fecha,
      notas: `Acordado: S/ ${p.acordado.toFixed(2)} | Pagado: S/ ${p.pagado.toFixed(2)}`,
    }));

    const totalMonto = rows.reduce((s, r) => s + parseFloat(r.monto || 0), 0);

    const headers = [
      { header: '#',        key: '_num',      width: 8  },
      { header: 'Cliente',  key: 'cliente',   width: 26, align: 'left' },
      { header: 'DNI',      key: 'dni',       width: 14 },
      { header: 'Teléfono', key: 'telefono',  width: 16 },
      { header: 'Email',    key: 'email',     width: 28, align: 'left' },
      { header: 'Plan',     key: 'plan',      width: 22 },
      { header: 'Monto',    key: 'monto',     width: 14, colorFn: () => 'FFCC0000' },
      { header: 'Fecha',    key: 'fecha_pago',width: 20 },
      { header: 'Notas',    key: 'notas',     width: 32, align: 'left' },
    ];

    const wb = buildStyledWorkbook('REPORTE DE PAGOS PENDIENTES', 'Pagos Pendientes', headers, rows,
      `PeruGym - Centro de Entrenamiento y Fitness  |  Total pendiente: S/ ${totalMonto.toFixed(2)}`);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="pagos-pendientes.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// STOCK DE PRODUCTOS Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stock/excel', async (req, res) => {
  try {
    const productos = await Producto.find().sort({ categoria: 1, nombre: 1 }).lean();

    const rows = productos.map(p => ({
      _num:        null,
      nombre:      p.nombre,
      categoria:   categoriaProducto(p),
      codigo:      p.codigo_barras || '-',
      precio_venta:p.precio_venta,
      costo:       Math.round((p.costo || 0) * 100) / 100,
      valorizado:  Math.round((p.costo || 0) * (p.stock || 0) * 100) / 100,
      stock:       p.stock,
      stock_minimo:p.stock_minimo ?? 5,
      estado:      p.activo ? 'Activo' : 'Inactivo',
      descripcion: p.descripcion || '-',
    }));

    const headers = [
      { header: '#',           key: '_num',        width: 8  },
      { header: 'Producto',    key: 'nombre',      width: 28, align: 'left' },
      { header: 'Categoría',   key: 'categoria',   width: 20 },
      { header: 'Código',      key: 'codigo',      width: 20, align: 'left' },
      { header: 'Precio (S/)', key: 'precio_venta',width: 14, colorFn: () => 'FF16A34A' },
      { header: 'Costo (S/)',  key: 'costo',       width: 14 },
      { header: 'Valorizado (S/)', key: 'valorizado', width: 16, colorFn: () => 'FF16A34A' },
      { header: 'Stock',       key: 'stock',       width: 12, colorFn: (v, r) => parseInt(v) <= (r && r.stock_minimo != null ? r.stock_minimo : 5) ? 'FFCC0000' : 'FF16A34A' },
      { header: 'Mínimo',      key: 'stock_minimo',width: 12 },
      { header: 'Estado',      key: 'estado',      width: 12, colorFn: v => v === 'Activo' ? 'FF16A34A' : 'FFCC0000' },
      { header: 'Descripción', key: 'descripcion', width: 36, align: 'left' },
    ];

    const wb = buildStyledWorkbook('REPORTE DE STOCK DE PRODUCTOS', 'Stock Productos', headers, rows, 'PeruGym - Centro de Entrenamiento y Fitness');
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="stock-productos.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPRAS A PROVEEDORES Excel (solo admin: incluye costos)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/compras/excel', requirePermission('compras'), async (req, res) => {
  const { from, to } = req.query;
  try {
    const filter = {};
    const range = dateFilter(from, to);
    if (range.$gte || range.$lt) filter.fecha = range;

    const compras = await Compra.find(filter).populate('proveedor_id', 'nombre').sort({ fecha: -1 }).lean();

    const rows = compras.map(c => ({
      _num:        null,
      fecha:       c.fecha,
      proveedor:   c.proveedor_id ? c.proveedor_id.nombre : (c.proveedor_nombre || 'Sin proveedor'),
      productos:   c.items.reduce((s, it) => s + it.cantidad, 0),
      items:       c.items.length,
      costo_total: c.costo_total,
      responsable: c.responsable,
      notas:       c.notas || '-',
    }));

    const headers = [
      { header: '#',            key: '_num',        width: 8  },
      { header: 'Fecha',        key: 'fecha',       width: 20 },
      { header: 'Proveedor',    key: 'proveedor',   width: 28, align: 'left' },
      { header: 'Unidades',     key: 'productos',   width: 12 },
      { header: 'Ítems',        key: 'items',       width: 10 },
      { header: 'Costo total (S/)', key: 'costo_total', width: 18, colorFn: () => 'FF16A34A' },
      { header: 'Registró',     key: 'responsable', width: 20, align: 'left' },
      { header: 'Notas',        key: 'notas',       width: 36, align: 'left' },
    ];

    const wb = buildStyledWorkbook('REPORTE DE COMPRAS', 'Compras', headers, rows, 'PeruGym - Centro de Entrenamiento y Fitness');
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="compras.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN DE CAJA Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/caja/excel', async (req, res) => {
  const { from, to } = req.query;
  try {
    const filter = {};
    if (from || to) {
      filter.apertura = dateFilter(from, to);
    }

    const cajas = await Caja.find(filter)
      .populate('usuario_id', 'usuario')
      .sort({ apertura: -1 })
      .lean();

    const mongoose = require('mongoose');
    const rows = await Promise.all(cajas.map(async (c) => {
      const ingresosMem = await Pago.aggregate([
        { $match: { caja_id: c._id, estado: 'pagado' } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]);
      const ingresosVentas = await Venta.aggregate([
        { $match: { caja_id: c._id, anulada: false } },
        { $unwind: '$items' },
        { $group: { _id: null, total: { $sum: '$items.subtotal' } } },
      ]);
      return {
        _num:                null,
        cajero:              c.usuario_id?.usuario || '-',
        apertura:            c.apertura,
        cierre:              c.cierre || '-',
        estado:              c.estado,
        monto_inicial:       c.monto_inicial,
        ingresos_membresias: ingresosMem[0]?.total || 0,
        ingresos_ventas:     ingresosVentas[0]?.total || 0,
        monto_final:         c.monto_final ?? '-',
        total_ingresos:      c.total_ingresos,
        notas:               c.notas || '-',
      };
        }));

    const totalIngresos = rows.reduce((s, r) => s + parseFloat(r.total_ingresos || 0), 0);
    const extra = from && to
      ? `PeruGym - Período: ${from} al ${to}  |  Total ingresos: S/ ${totalIngresos.toFixed(2)}`
      : `PeruGym - Centro de Entrenamiento y Fitness  |  Total ingresos: S/ ${totalIngresos.toFixed(2)}`;

    const headers = [
      { header: '#',                    key: '_num',               width: 8  },
      { header: 'Cajero',               key: 'cajero',             width: 22, align: 'left' },
      { header: 'Apertura',             key: 'apertura',           width: 20 },
      { header: 'Cierre',               key: 'cierre',             width: 20 },
      { header: 'Estado',               key: 'estado',             width: 14, colorFn: v => v === 'cerrada' ? 'FF374151' : 'FF16A34A' },
      { header: 'Monto Inicial (S/)',   key: 'monto_inicial',      width: 18 },
      { header: 'Ing. Membresías (S/)', key: 'ingresos_membresias',width: 20, colorFn: () => 'FF16A34A' },
      { header: 'Ing. Ventas (S/)',     key: 'ingresos_ventas',    width: 18, colorFn: () => 'FF16A34A' },
      { header: 'Monto Final (S/)',     key: 'monto_final',        width: 18 },
      { header: 'Total Ingresos (S/)',  key: 'total_ingresos',     width: 20, colorFn: () => 'FF16A34A' },
      { header: 'Notas',                key: 'notas',              width: 30, align: 'left' },
    ];

    const wb = buildStyledWorkbook('RESUMEN DE CAJA', 'Resumen Caja', headers, rows, extra);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="resumen-caja.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// VENTAS Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ventas/excel', async (req, res) => {
  const { from, to, caja_id } = req.query;
  try {
    const filter = { anulada: false };
    if (from || to) {
      filter.fecha_venta = dateFilter(from, to);
    }
    if (caja_id) filter.caja_id = caja_id;

    const ventas = await Venta.find(filter)
      .populate('cliente_id', 'nombre')
      .populate('items.producto_id', 'nombre categoria')
      .sort({ fecha_venta: -1 })
      .lean();

    const rows = [];
    for (const v of ventas) {
      for (const item of v.items) {
        rows.push({
          _num:        null,
          id:          v._id.toString().slice(-6).toUpperCase(),
          cliente:     v.cliente_id?.nombre || '-',
          producto:    item.producto_id?.nombre || 'Producto no disponible',
          categoria:   categoriaProducto(item.producto_id),
          cantidad:    item.cantidad,
          precio_unit: item.precio_unit,
          subtotal:    item.subtotal,
          fecha_venta: v.fecha_venta,
        });
      }
    }

    const totalVentas = rows.reduce((s, r) => s + parseFloat(r.subtotal || 0), 0);
    const extra = from && to
      ? `PeruGym - Período: ${from} al ${to}  |  Total ventas: S/ ${totalVentas.toFixed(2)}`
      : `PeruGym - Centro de Entrenamiento y Fitness  |  Total ventas: S/ ${totalVentas.toFixed(2)}`;

    const headers = [
      { header: '#',            key: '_num',       width: 8  },
      { header: 'Venta ID',     key: 'id',         width: 12 },
      { header: 'Cliente',      key: 'cliente',    width: 26, align: 'left' },
      { header: 'Producto',     key: 'producto',   width: 26, align: 'left' },
      { header: 'Categoría',    key: 'categoria',  width: 22, align: 'left' },
      { header: 'Cantidad',     key: 'cantidad',   width: 12 },
      { header: 'Precio Unit.', key: 'precio_unit',width: 16, colorFn: () => 'FF374151' },
      { header: 'Subtotal',     key: 'subtotal',   width: 16, colorFn: () => 'FF16A34A' },
      { header: 'Fecha',        key: 'fecha_venta',width: 22 },
    ];

    const wb = buildStyledWorkbook('REPORTE DE VENTAS', 'Ventas', headers, rows, extra);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ventas.xlsx"');
    res.end(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// INGRESOS DE CAJA — CATEGORIZADO POR CAJERO
// Query params: from, to
// Estructura: Hoja "Resumen por Cajero" (buildStyledWorkbook) +
//             una hoja por cajero con secciones por categoría
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ingresos-caja/excel', async (req, res) => {
  const { from, to } = req.query;
  const MovimientoCaja = require('../models/MovimientoCaja');

  // Misma paleta que buildStyledWorkbook
  const RED_DARK  = 'FF7B2D2D';
  const RED_MID   = 'FFA0522D';
  const WHITE     = 'FFFFFFFF';
  const PEACH     = 'FFFFC9A0';
  const GRAY_BG   = 'FFF1F5F9';
  const ROW_EVEN  = 'FFF8FAFC';
  const ROW_ODD   = 'FFFFFFFF';
  const TEXT_DARK = 'FF374151';
  const GREEN     = 'FF16A34A';
  const AMBER     = 'FFA16207';
  const LOGO_PATH = path.join(__dirname, '..', 'public', 'imagenes', 'index', 'WhatsApp Image 2026-04-12 at 7.00.32 PM.png');
  // Colores por categoría
  const BLUE = 'FF0070C0', TEAL = 'FF00B050', ORANGE = 'FFFF8C00', PURPLE = 'FF7030A0', PINK = 'FFF48FB1';
  const CAT_COLORS = [BLUE, TEAL, ORANGE, PURPLE, PINK, 'FF16A34A', 'FFA16207', 'FFDC2626', 'FF6D28D9', 'FF0D9488'];
  const CAT_ICONS  = { 'bebida':'🥤', 'bebida natural':'🍃', 'snacks':'🍫', 'suplementos':'💊', 'yogurt':'🥛' };

  const buildFechaFilter = (f, t) => {
    const r = {};
    if (f) { const [y,m,d] = f.split('-').map(Number); r.$gte = new Date(Date.UTC(y,m-1,d,5,0,0,0)); }
    if (t) { const [y,m,d] = t.split('-').map(Number); r.$lte = new Date(Date.UTC(y,m-1,d+1,4,59,59,999)); }
    return r;
  };

  try {
    const fechaFilter  = buildFechaFilter(from, to);
    const hasFecha     = Object.keys(fechaFilter).length > 0;
    const periodoLabel = from && to ? `Período: ${from} al ${to}` : from ? `Desde: ${from}` : to ? `Hasta: ${to}` : 'Todos los registros';

    // 1. Cajas del período
    // Buscamos por FECHA DE LOS MOVIMIENTOS/PAGOS, no por apertura de caja,
    // para no perder datos cuando la caja se abrió fuera del rango.
    // Primero obtenemos todas las cajas y luego filtramos por los datos.
    const todasCajas = await Caja.find({}).populate('usuario_id', 'usuario').sort({ apertura: 1 }).lean();

    // Si hay filtro de fecha, encontrar qué cajas tienen actividad en ese rango
    let cajas;
    if (hasFecha) {
      // Obtener IDs de cajas que tienen pagos, movimientos o ventas en el rango
      const [pagosCajaIds, movsCajaIds, ventasCajaIds] = await Promise.all([
        Pago.distinct('caja_id', { estado: 'pagado', fecha_pago: { ...fechaFilter } }),
        MovimientoCaja.distinct('caja_id', { tipo: 'ingreso', fecha: { ...fechaFilter } }),
        Venta.distinct('caja_id', { anulada: false, fecha_venta: { ...fechaFilter } }),
      ]);
      const activeCajaIds = new Set([
        ...pagosCajaIds.map(id => id.toString()),
        ...movsCajaIds.map(id => id.toString()),
        ...ventasCajaIds.map(id => id.toString()),
      ]);
      cajas = todasCajas.filter(c => activeCajaIds.has(c._id.toString()));
    } else {
      cajas = todasCajas;
    }

    if (!cajas.length) {
      const wb0 = buildStyledWorkbook('INGRESOS DE CAJA', 'Sin datos',
        [{ header: 'Información', key: 'info', width: 55 }],
        [{ info: `No hay cajas registradas para: ${periodoLabel}` }],
        `PeruGym | ${periodoLabel}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="ingresos-caja-sin-datos.xlsx"`);
      return res.end(await wb0.xlsx.writeBuffer());
    }

    const cajaIds = cajas.map(c => c._id);

    // 2. Datos paralelos — filtrar por caja_id Y por fecha para acotar exactamente el período
    const pagoQuery   = { estado: 'pagado', caja_id: { $in: cajaIds } };
    const movQuery    = { tipo: 'ingreso',  caja_id: { $in: cajaIds } };
    const ventaQuery  = { anulada: false,   caja_id: { $in: cajaIds } };
    if (hasFecha) {
      pagoQuery.fecha_pago  = { ...fechaFilter };
      movQuery.fecha        = { ...fechaFilter };
      ventaQuery.fecha_venta= { ...fechaFilter };
    }

    const [todosLosPagos, todosLosMovs, todasLasVentas] = await Promise.all([
      Pago.find(pagoQuery)
        .populate('cliente_id', 'nombre')
        .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre precio' } })
        .sort({ fecha_pago: -1 }).lean(),
      MovimientoCaja.find(movQuery)
        .populate('usuario_id', 'usuario').sort({ fecha: -1 }).lean(),
      Venta.find(ventaQuery)
        .populate('cliente_id', 'nombre')
        .populate('items.producto_id', 'nombre categoria')
        .sort({ fecha_venta: -1 }).lean(),
    ]);

    // 3. Agrupar por cajero y por categoría real del producto
    const cajeroMap = new Map();
    for (const c of cajas) {
      const n = c.usuario_id?.usuario || 'Sin cajero';
      if (!cajeroMap.has(n)) cajeroMap.set(n, { nombre: n, cajaIds: [], pagos: [], rutinas: [], otrosMovs: [], categorias: new Map() });
      cajeroMap.get(n).cajaIds.push(c._id.toString());
    }
    for (const p of todosLosPagos) { const id = p.caja_id?.toString(); for (const [,cj] of cajeroMap) { if (cj.cajaIds.includes(id)) { cj.pagos.push(p); break; } } }
    for (const m of todosLosMovs)  { const id = m.caja_id?.toString(); for (const [,cj] of cajeroMap) { if (cj.cajaIds.includes(id)) { m.es_rutina ? cj.rutinas.push(m) : cj.otrosMovs.push(m); break; } } }
    for (const v of todasLasVentas) {
      const id = v.caja_id?.toString();
      for (const [,cj] of cajeroMap) {
        if (cj.cajaIds.includes(id)) {
          for (const item of v.items) {
            const cat = categoriaProducto(item.producto_id);
            const r = { cliente: v.cliente_id?.nombre||'-', producto: item.producto_id?.nombre||'Producto no disponible', categoria: cat, cantidad: item.cantidad, precio_unit: item.precio_unit, subtotal: item.subtotal, metodo_pago: v.metodo_pago, fecha: v.fecha_venta };
            if (!cj.categorias.has(cat)) cj.categorias.set(cat, []);
            cj.categorias.get(cat).push(r);
          }
          break;
        }
      }
    }

    // 4. Totales
    const sumArr = (arr, fn) => arr.reduce((s, r) => s + parseFloat(fn(r) || 0), 0);
    const cajeros = [...cajeroMap.values()].map(cj => {
      const catTotals = new Map();
      for (const [cat, items] of cj.categorias) {
        catTotals.set(cat, { count: items.length, total: sumArr(items, r => r.subtotal) });
      }
      const totalCat = [...catTotals.values()].reduce((s, ct) => s + ct.total, 0);
      return {
        ...cj,
        totalMem:  sumArr(cj.pagos,      p => p.monto),
        totalRut:  sumArr(cj.rutinas,    m => m.monto),
        totalOtrM: sumArr(cj.otrosMovs,  m => m.monto),
        catTotals,
        total: totalCat + sumArr(cj.pagos, p => p.monto) + sumArr(cj.rutinas, m => m.monto) + sumArr(cj.otrosMovs, m => m.monto),
      };
    });
    const grandTotal = cajeros.reduce((s, cj) => s + cj.total, 0);

    // Recopilar todas las categorías únicas de todos los cajeros
    const allCategories = [...new Set(cajeros.flatMap(cj => [...cj.catTotals.keys()]))];

    // ═════════════════════════════════════════════════════════════════
    // HOJA 1 — RESUMEN: usa buildStyledWorkbook (= estilo idéntico)
    // ═════════════════════════════════════════════════════════════════
    const resHeaders = [
      { header: '#',           key: '_num',  width: 15.14  },
      { header: 'Cajero',      key: 'nombre',width: 22, align: 'left' },
      { header: 'Membresías',  key: 'mem',   width: 16, colorFn: () => BLUE   },
      { header: 'Rutinas',     key: 'rut',   width: 14, colorFn: () => TEAL   },
    ];
    allCategories.forEach((cat, i) => {
      const catKey = 'cat_' + i;
      resHeaders.push({ header: cat, key: catKey, width: 18, colorFn: () => CAT_COLORS[i % CAT_COLORS.length] });
    });
    resHeaders.push({ header: 'Otros ingresos manuales', key: 'otrM', width: 26, colorFn: () => AMBER });
    resHeaders.push({ header: 'TOTAL (S/)', key: 'total', width: 16, colorFn: () => GREEN });

    const resRows = cajeros.map(cj => {
      const row = {
        nombre: cj.nombre,
        mem:   `S/ ${cj.totalMem.toFixed(2)}`,
        rut:   `S/ ${cj.totalRut.toFixed(2)}`,
        otrM:  `S/ ${cj.totalOtrM.toFixed(2)}`,
        total: `S/ ${cj.total.toFixed(2)}`,
      };
      allCategories.forEach((cat, i) => {
        const ct = cj.catTotals.get(cat);
        row['cat_' + i] = ct ? `S/ ${ct.total.toFixed(2)}` : 'S/ 0.00';
      });
      return row;
    });
    const wb = buildStyledWorkbook(
      'INGRESOS DE CAJA — RESUMEN POR CAJERO',
      'Resumen por Cajero',
      resHeaders, resRows,
      `PeruGym | ${periodoLabel}  |  GRAN TOTAL: S/ ${grandTotal.toFixed(2)}`
    );

    // Ajustar la fila de totales generada por buildStyledWorkbook para mostrar el gran total monetario
    const wsRes = wb.worksheets[0];
    const lastResCol = String.fromCharCode(64 + resHeaders.length);
    const totalRowRes = 6 + resRows.length;
    try { wsRes.unMergeCells(`A${totalRowRes}:${lastResCol}${totalRowRes}`); } catch (_) {}
    const midR = Math.ceil(resHeaders.length / 2);
    wsRes.mergeCells(`A${totalRowRes}:${String.fromCharCode(64+midR)}${totalRowRes}`);
    wsRes.getCell(`A${totalRowRes}`).value     = `Total cajeros: ${cajeros.length}`;
    wsRes.getCell(`A${totalRowRes}`).font      = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
    wsRes.getCell(`A${totalRowRes}`).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };
    wsRes.getCell(`A${totalRowRes}`).alignment = { vertical: 'middle', horizontal: 'left', indent: 2 };
    wsRes.mergeCells(`${String.fromCharCode(65+midR)}${totalRowRes}:${lastResCol}${totalRowRes}`);
    wsRes.getCell(`${String.fromCharCode(65+midR)}${totalRowRes}`).value     = `GRAN TOTAL: S/ ${grandTotal.toFixed(2)}`;
    wsRes.getCell(`${String.fromCharCode(65+midR)}${totalRowRes}`).font      = { name: 'Calibri', size: 11, bold: true, color: { argb: WHITE } };
    wsRes.getCell(`${String.fromCharCode(65+midR)}${totalRowRes}`).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_DARK } };
    wsRes.getCell(`${String.fromCharCode(65+midR)}${totalRowRes}`).alignment = { vertical: 'middle', horizontal: 'right', indent: 2 };
    wsRes.getRow(totalRowRes).height = 22;
    wsRes.tabColor = { argb: RED_DARK };

    // ═════════════════════════════════════════════════════════════════
    // HOJAS POR CAJERO — mismo estilo exacto que buildStyledWorkbook
    // ═════════════════════════════════════════════════════════════════
    const tabColors = ['FF0070C0','FF00B050','FFFF8C00','FF7030A0','FFE91E8C','FF374151'];

    // columnas fijas (9 = máximo entre todas las secciones)
    const MAX_COLS   = 9;
    const lastCajCol = String.fromCharCode(64 + MAX_COLS);

    // cabeceras de cada sección
    const hMem = [
      { header: '#',           key: '_num',       width: 15.14  },
      { header: 'Cliente',     key: 'cliente',    width: 26, align: 'left' },
      { header: 'Plan',        key: 'plan',       width: 22, align: 'left' },
      { header: 'Monto (S/)',  key: 'monto',      width: 14, colorFn: () => GREEN },
      { header: 'Método Pago', key: 'metodo_pago',width: 14 },
      { header: 'Fecha',       key: 'fecha',      width: 20 },
      { header: 'Es Abono',    key: 'es_abono',   width: 10, colorFn: v => v === 'Sí' ? AMBER : '' },
      { header: 'N° Abono',    key: 'num_abono',  width: 10 },
      { header: 'Notas',       key: 'notas',      width: 28, align: 'left' },
    ];
    const hRut = [
      { header: '#',           key: '_num',       width: 15.14  },
      { header: 'Concepto',    key: 'concepto',   width: 30, align: 'left' },
      { header: 'Monto (S/)',  key: 'monto',      width: 14, colorFn: () => GREEN },
      { header: 'Método Pago', key: 'metodo_pago',width: 14 },
      { header: 'Cajero',      key: 'cajero',     width: 18, align: 'left' },
      { header: 'Hora',        key: 'fecha',      width: 20 },
    ];
    const hProd = [
      { header: '#',            key: '_num',       width: 15.14  },
      { header: 'Producto',     key: 'producto',   width: 26, align: 'left' },
      { header: 'Categoría',    key: 'categoria',  width: 18, align: 'left' },
      { header: 'Cant.',        key: 'cantidad',   width: 8  },
      { header: 'P. Unit (S/)', key: 'precio_unit',width: 14, colorFn: () => TEXT_DARK },
      { header: 'Subtotal (S/)',key: 'subtotal',   width: 14, colorFn: () => GREEN },
      { header: 'Método Pago',  key: 'metodo_pago',width: 14 },
      { header: 'Cliente',      key: 'cliente',    width: 22, align: 'left' },
      { header: 'Hora',         key: 'fecha',      width: 20 },
    ];
    const hOtrM = [
      { header: '#',           key: '_num',       width: 15.14  },
      { header: 'Concepto',    key: 'concepto',   width: 32, align: 'left' },
      { header: 'Monto (S/)',  key: 'monto',      width: 14, colorFn: () => GREEN },
      { header: 'Método Pago', key: 'metodo_pago',width: 14 },
      { header: 'Cajero',      key: 'cajero',     width: 18, align: 'left' },
      { header: 'Hora',        key: 'fecha',      width: 20 },
    ];

    // ── Helpers internos — copian EXACTAMENTE buildStyledWorkbook ──────────────
    const _writeHeader = (ws, titulo, subtitulo) => {
      ws.getRow(1).height = 70; ws.getRow(2).height = 22; ws.getRow(3).height = 18; ws.getRow(4).height = 5;
      ws.mergeCells(`A1:${lastCajCol}1`);
      ws.getCell('A1').fill = { type:'pattern',pattern:'solid',fgColor:{argb:RED_DARK} };
      ws.getCell('A1').value = '     ' + titulo;
      ws.getCell('A1').font  = { name:'Calibri',size:14,bold:true,color:{argb:WHITE} };
      ws.getCell('A1').alignment = { vertical:'middle',horizontal:'left',indent:8 };
      try { if (fs.existsSync(LOGO_PATH)) { const lid = wb.addImage({buffer:fs.readFileSync(LOGO_PATH),extension:'png'}); ws.addImage(lid,{tl:{col:0,row:0},ext:{width:95,height:92},editAs:'oneCell'}); } } catch(_){}
      ws.mergeCells(`A2:${lastCajCol}2`);
      ws.getCell('A2').value = subtitulo;
      ws.getCell('A2').font  = { name:'Calibri',size:9,italic:true,color:{argb:PEACH} };
      ws.getCell('A2').alignment = { vertical:'middle',horizontal:'left',indent:9 };
      ws.getCell('A2').fill  = { type:'pattern',pattern:'solid',fgColor:{argb:RED_DARK} };
      for (let c=1;c<=MAX_COLS;c++) ws.getCell(3,c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:GRAY_BG}};
      ws.getCell('A3').value='Sistema:'; ws.getCell('A3').font={bold:true,color:{argb:RED_DARK},size:9}; ws.getCell('A3').alignment={indent:1};
      const m1=String.fromCharCode(65+Math.floor(MAX_COLS/2)-1), m2=String.fromCharCode(65+Math.floor(MAX_COLS/2)), m3=String.fromCharCode(66+Math.floor(MAX_COLS/2));
      ws.mergeCells(`B3:${m1}3`); ws.getCell('B3').value='PeruGym v1.0'; ws.getCell('B3').font={size:9,color:{argb:TEXT_DARK}};
      ws.getCell(`${m2}3`).value='Generado:'; ws.getCell(`${m2}3`).font={bold:true,color:{argb:RED_DARK},size:9};
      if (m3<=lastCajCol) ws.mergeCells(`${m3}3:${lastCajCol}3`);
      ws.getCell(`${m3}3`).value=new Date().toLocaleString('es-PE',{timeZone:'America/Lima'}); ws.getCell(`${m3}3`).font={size:9,color:{argb:TEXT_DARK}};
      ws.mergeCells(`A4:${lastCajCol}4`); ws.getCell('A4').fill={type:'pattern',pattern:'solid',fgColor:{argb:RED_MID}};
    };

    const _writeTableHeaders = (ws, rowNum, headers, bg) => {
      headers.forEach((h, idx) => {
        const cell = ws.getCell(rowNum, idx+1);
        cell.value = h.header;
        cell.font  = { name:'Calibri',size:11,bold:true,color:{argb:WHITE} };
        cell.fill  = { type:'pattern',pattern:'solid',fgColor:{argb:bg||RED_DARK} };
        cell.alignment = { vertical:'middle',horizontal:'center' };
        cell.border = { top:{style:'thin',color:{argb:RED_MID}},bottom:{style:'thin',color:{argb:RED_MID}},left:{style:'thin',color:{argb:RED_MID}},right:{style:'thin',color:{argb:RED_MID}} };
      });
      ws.getRow(rowNum).height = 22;
    };

    const _writeDataRows = (ws, startRow, headers, rows) => {
      rows.forEach((r, i) => {
        const rowNum = startRow+i;
        ws.getRow(rowNum).height = 18;
        const bg = i%2===0 ? ROW_EVEN : ROW_ODD;
        headers.forEach((h, idx) => {
          const cell = ws.getCell(rowNum, idx+1);
          let val = h.key==='_num' ? i+1 : r[h.key];
          if (val===null||val===undefined) val='-';
          if (val instanceof Date) val=val.toLocaleString('es-PE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
          cell.value=val; cell.font={name:'Calibri',size:10}; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}};
          cell.alignment={vertical:'middle',horizontal:(idx<=1||h.align==='left')?'left':(h.align||'center')};
          cell.border={bottom:{style:'hair',color:{argb:'FFE2E8F0'}},right:{style:'hair',color:{argb:'FFE2E8F0'}}};
          if (h.colorFn) { const clr=h.colorFn(val, r); if(clr) cell.font={name:'Calibri',size:10,bold:true,color:{argb:clr}}; }
        });
      });
      return startRow+rows.length;
    };

    const _writeSectionTitle = (ws, rowNum, label, bg) => {
      ws.mergeCells(`A${rowNum}:${lastCajCol}${rowNum}`);
      ws.getCell(`A${rowNum}`).value     = label;
      ws.getCell(`A${rowNum}`).font      = { name:'Calibri',size:11,bold:true,color:{argb:WHITE} };
      ws.getCell(`A${rowNum}`).fill      = { type:'pattern',pattern:'solid',fgColor:{argb:bg} };
      ws.getCell(`A${rowNum}`).alignment = { vertical:'middle',horizontal:'left',indent:2 };
      ws.getRow(rowNum).height = 20;
      return rowNum+1;
    };

    const _writeSectionTotal = (ws, rowNum, headers, label, value, bg) => {
      const lc  = String.fromCharCode(64+headers.length);
      const mid = Math.ceil(headers.length/2);
      const mc  = String.fromCharCode(64+mid);
      const mn  = String.fromCharCode(65+mid);
      ws.mergeCells(`A${rowNum}:${mc}${rowNum}`);
      ws.getCell(`A${rowNum}`).value     = label;
      ws.getCell(`A${rowNum}`).font      = { name:'Calibri',size:10,bold:true,color:{argb:WHITE} };
      ws.getCell(`A${rowNum}`).fill      = { type:'pattern',pattern:'solid',fgColor:{argb:bg} };
      ws.getCell(`A${rowNum}`).alignment = { vertical:'middle',horizontal:'left',indent:2 };
      if (mn<=lc) {
        ws.mergeCells(`${mn}${rowNum}:${lc}${rowNum}`);
        ws.getCell(`${mn}${rowNum}`).value     = `S/ ${parseFloat(value).toFixed(2)}`;
        ws.getCell(`${mn}${rowNum}`).font      = { name:'Calibri',size:10,bold:true,color:{argb:WHITE} };
        ws.getCell(`${mn}${rowNum}`).fill      = { type:'pattern',pattern:'solid',fgColor:{argb:bg} };
        ws.getCell(`${mn}${rowNum}`).alignment = { vertical:'middle',horizontal:'right',indent:2 };
      }
      ws.getRow(rowNum).height = 20;
      return rowNum+2;
    };

    // ── Generar una hoja por cajero ───────────────────────────────────────────
    for (let ci = 0; ci < cajeros.length; ci++) {
      const cj = cajeros[ci];
      const sheetName = cj.nombre.replace(/[:\\/?*[\]]/g,'').substring(0,28) || `Cajero-${ci+1}`;
      const ws = wb.addWorksheet(sheetName, {
        pageSetup: { paperSize:9, orientation:'landscape', fitToPage:true },
        tabColor:  { argb: tabColors[ci % tabColors.length] }
      });
      ws.columns = [15.14,26,22,14,14,14,14,22,20].map(w => ({ width: w }));

      _writeHeader(ws,
        `INGRESOS DE CAJA — ${cj.nombre.toUpperCase()}`,
        `PeruGym | ${periodoLabel}  |  Total cajero: S/ ${cj.total.toFixed(2)}  |  Membresías: ${cj.pagos.length}  |  Rutinas: ${cj.rutinas.length}  |  Ventas: ${[...cj.categorias.values()].reduce((s,a)=>s+a.length,0)} ítem(s)`
      );

      // Fila 5: mini-resumen del cajero
      const hMini = [
        { header: 'Categoría',      key: 'cat',   width: 22, align: 'left' },
        { header: 'N° Operaciones', key: 'n',     width: 16 },
        { header: 'Total (S/)',     key: 'total', width: 16, colorFn: () => GREEN },
        { header: '% del Cajero',   key: 'porc',  width: 14 },
      ];
      _writeTableHeaders(ws, 5, hMini, RED_DARK);
      const miniRows = [
        { cat:'💳 Membresías',  n:cj.pagos.length,     total:`S/ ${cj.totalMem.toFixed(2)}`,  porc:cj.total?((cj.totalMem /cj.total)*100).toFixed(1)+'%':'0%' },
        { cat:'🏃 Rutinas',     n:cj.rutinas.length,   total:`S/ ${cj.totalRut.toFixed(2)}`,  porc:cj.total?((cj.totalRut /cj.total)*100).toFixed(1)+'%':'0%' },
      ];
      let catIdx = 0;
      for (const [cat, items] of cj.categorias) {
        const ct = cj.catTotals.get(cat);
        const icon = CAT_ICONS[cat.toLowerCase()] || '📦';
        miniRows.push({ cat: `${icon} ${cat}`, n: items.length, total: `S/ ${ct.total.toFixed(2)}`, porc: cj.total ? ((ct.total / cj.total) * 100).toFixed(1) + '%' : '0%' });
        catIdx++;
      }
      miniRows.push({ cat:'Otros ingresos manuales', n:cj.otrosMovs.length, total:`S/ ${cj.totalOtrM.toFixed(2)}`, porc:cj.total?((cj.totalOtrM/cj.total)*100).toFixed(1)+'%':'0%' });
      let row = _writeDataRows(ws, 6, hMini, miniRows);

      // Fila total del mini-resumen
      const lc4 = String.fromCharCode(64+hMini.length);
      ws.mergeCells(`A${row}:${lc4}${row}`);
      const totalItems = cj.pagos.length + cj.rutinas.length + [...cj.categorias.values()].reduce((s,a) => s+a.length, 0) + cj.otrosMovs.length;
      ws.getCell(`A${row}`).value     = `Total de registros del cajero: ${totalItems}  |  TOTAL: S/ ${cj.total.toFixed(2)}`;
      ws.getCell(`A${row}`).font      = { name:'Calibri',size:10,bold:true,color:{argb:WHITE} };
      ws.getCell(`A${row}`).fill      = { type:'pattern',pattern:'solid',fgColor:{argb:RED_DARK} };
      ws.getCell(`A${row}`).alignment = { vertical:'middle',horizontal:'right' };
      ws.getRow(row).height = 20;
      row += 2;

      // SECCIÓN 1 — MEMBRESÍAS
      row = _writeSectionTitle(ws, row, '💳  MEMBRESÍAS VENDIDAS', BLUE);
      _writeTableHeaders(ws, row, hMem, BLUE); row++;
      const rMem = cj.pagos.map(p => ({
        cliente: p.cliente_id?.nombre || '-', plan: presentarPago(p).plan_nombre || '-',
        monto: p.monto, metodo_pago: p.metodo_pago, fecha: p.fecha_pago,
        es_abono: p.es_abono ? 'Sí' : 'No', num_abono: p.numero_abono ?? '-', notas: p.notas || '-',
      }));
      row = _writeDataRows(ws, row, hMem, rMem);
      row = _writeSectionTotal(ws, row, hMem, `Total registros: ${rMem.length}`, cj.totalMem, BLUE);

      // SECCIÓN 2 — RUTINAS
      row = _writeSectionTitle(ws, row, '🏃  RUTINAS (INGRESOS RÁPIDOS)', TEAL);
      _writeTableHeaders(ws, row, hRut, TEAL); row++;
      const rRut = cj.rutinas.map(m => ({ concepto:m.concepto||'-', monto:m.monto, metodo_pago:m.metodo_pago, cajero:m.usuario_id?.usuario||'-', fecha:m.fecha }));
      row = _writeDataRows(ws, row, hRut, rRut);
      row = _writeSectionTotal(ws, row, hRut, `Total registros: ${rRut.length}`, cj.totalRut, TEAL);

      // SECCIONES DINÁMICAS — UNA POR CATEGORÍA DE PRODUCTO
      let colorIdx = 0;
      for (const [cat, items] of cj.categorias) {
        const catColor = CAT_COLORS[colorIdx % CAT_COLORS.length];
        const icon = CAT_ICONS[cat.toLowerCase()] || '📦';
        const ct = cj.catTotals.get(cat);
        row = _writeSectionTitle(ws, row, `${icon}  VENTAS — ${cat.toUpperCase()}`, catColor);
        _writeTableHeaders(ws, row, hProd, catColor); row++;
        row = _writeDataRows(ws, row, hProd, items);
        row = _writeSectionTotal(ws, row, hProd, `Total registros: ${items.length}`, ct.total, catColor);
        colorIdx++;
      }

      // SECCIÓN FINAL — OTROS INGRESOS MANUALES
      row = _writeSectionTitle(ws, row, '➕  OTROS INGRESOS MANUALES', AMBER);
      _writeTableHeaders(ws, row, hOtrM, AMBER); row++;
      const rOtrM = cj.otrosMovs.map(m => ({ concepto:m.concepto||'-', monto:m.monto, metodo_pago:m.metodo_pago, cajero:m.usuario_id?.usuario||'-', fecha:m.fecha }));
      row = _writeDataRows(ws, row, hOtrM, rOtrM);
      row = _writeSectionTotal(ws, row, hOtrM, `Total registros: ${rOtrM.length}`, cj.totalOtrM, AMBER);

      // Cierre: fila de gran total del cajero (igual que buildStyledWorkbook)
      row++;
      ws.mergeCells(`A${row}:${lastCajCol}${row}`);
      ws.getCell(`A${row}`).value     = `GRAN TOTAL DEL CAJERO ${cj.nombre.toUpperCase()}:   S/ ${cj.total.toFixed(2)}`;
      ws.getCell(`A${row}`).font      = { name:'Calibri',size:13,bold:true,color:{argb:WHITE} };
      ws.getCell(`A${row}`).fill      = { type:'pattern',pattern:'solid',fgColor:{argb:RED_DARK} };
      ws.getCell(`A${row}`).alignment = { vertical:'middle',horizontal:'center' };
      ws.getRow(row).height = 26;
      ws.headerFooter.oddFooter = `&LPeruGym - Sistema de Gestion&C&"Calibri,Italic"Ingresos - ${cj.nombre}&RPagina &P de &N`;
    }

    // Enviar
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ingresos-caja-${from||'all'}-${to||'all'}.xlsx"`);
    res.end(await wb.xlsx.writeBuffer());

  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGOS PDF
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pagos/pdf', async (req, res) => {
  const { from, to } = req.query;
  try {
    const filter = {};
    if (from || to) filter.fecha_pago = dateFilter(from, to);
    if (req.query.estado) filter.estado = req.query.estado;
    if (req.query.metodo_pago) filter.metodo_pago = req.query.metodo_pago;

    const pagos = await Pago.find(filter)
      .populate('cliente_id', 'nombre')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
      .sort({ fecha_pago: -1 })
      .lean();

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=pagos.pdf');
    doc.pipe(res);

    doc.fontSize(18).text('Reporte de Pagos', { align: 'center' });
    if (from && to) doc.fontSize(10).text(`Período: ${from} - ${to}`, { align: 'center' });
    doc.moveDown();

    const total = pagos.filter(p => p.estado === 'pagado').reduce((sum, p) => sum + parseFloat(p.monto), 0);
    doc.fontSize(12).text(`Total registros: ${pagos.length}  |  Cobrado: S/. ${total.toFixed(2)}`);
    doc.moveDown();

    pagos.forEach(p => {
      doc.fontSize(10).text(
        `${limaDate(p.fecha_pago)} | ${p.cliente_id?.nombre || '-'} | ${presentarPago(p).plan_nombre || '-'} | S/. ${p.monto} | ${p.metodo_pago} | ${p.estado}`
      );
    });

    doc.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
