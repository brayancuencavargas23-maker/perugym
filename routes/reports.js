const router = require('express').Router();
const Pago = require('../models/Pago');
const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const Producto = require('../models/Producto');
const Venta = require('../models/Venta');
const Caja = require('../models/Caja');
const { verifyToken, requireRole } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

router.use(verifyToken, requireRole('admin', 'recepcionista'));

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

  if (fs.existsSync(LOGO_PATH)) {
    const logoId = wb.addImage({ filename: LOGO_PATH, extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 95, height: 92 }, editAs: 'oneCell' });
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
      if (val instanceof Date) val = val.toISOString().split('T')[0];

      cell.value = idx === 0 ? i + 1 : val;
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
        const color = h.colorFn(val);
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
      filter.fecha_pago = {};
      if (from) filter.fecha_pago.$gte = new Date(from);
      if (to)   filter.fecha_pago.$lte = new Date(to);
    }

    const pagos = await Pago.find(filter)
      .populate('cliente_id', 'nombre')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
      .sort({ fecha_pago: -1 });

    const rows = pagos.map(p => ({
      _num:        null,
      cliente:     p.cliente_id?.nombre || '-',
      plan:        p.membresia_id?.plan_id?.nombre || '-',
      monto:       p.monto,
      metodo_pago: p.metodo_pago,
      fecha_pago:  p.fecha_pago,
      estado:      p.estado,
      notas:       p.notas || '-',
    }));

    const totalMonto = rows.reduce((s, r) => s + parseFloat(r.monto || 0), 0);
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
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="pagos.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTES Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/clientes/excel', async (req, res) => {
  try {
    const clientes = await Cliente.find().sort({ nombre: 1 });

    const rows = await Promise.all(clientes.map(async (c) => {
      const mem = await Membresia.findOne({ cliente_id: c._id })
        .populate('plan_id', 'nombre')
        .sort({ fecha_fin: -1 });
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
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes.xlsx"');
    await wb.xlsx.write(res);
    res.end();
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
      filter.fecha = {};
      if (from) filter.fecha.$gte = new Date(from);
      if (to) { const t = new Date(to); t.setDate(t.getDate() + 1); filter.fecha.$lt = t; }
    }

    const asistencias = await require('../models/Asistencia').find(filter)
      .populate('cliente_id', 'nombre')
      .sort({ fecha: -1, entrada: -1 });

    const rows = asistencias.map(a => {
      const entrada = a.entrada ? a.entrada.toTimeString().slice(0, 5) : '-';
      const salida  = a.salida  ? a.salida.toTimeString().slice(0, 5)  : '-';
      let duracion = 'En curso';
      if (a.salida) {
        const secs = Math.round((a.salida - a.entrada) / 1000);
        duracion = secs < 60 ? `${secs} seg` : `${Math.round(secs / 60)} min`;
      }
      return {
        _num:    null,
        cliente: a.cliente_id?.nombre || '-',
        fecha:   a.fecha ? a.fecha.toISOString().split('T')[0] : a.entrada.toISOString().split('T')[0],
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
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="asistencias.xlsx"');
    await wb.xlsx.write(res);
    res.end();
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
      .sort({ fecha_fin: 1 });

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
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="membresias.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGOS PENDIENTES Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pagos-pendientes/excel', async (req, res) => {
  try {
    const pagos = await Pago.find({ estado: 'pendiente' })
      .populate('cliente_id', 'nombre dni telefono email')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
      .sort({ fecha_pago: 1 });

    const rows = pagos.map(p => ({
      _num:      null,
      cliente:   p.cliente_id?.nombre || '-',
      dni:       p.cliente_id?.dni || '-',
      telefono:  p.cliente_id?.telefono || '-',
      email:     p.cliente_id?.email || '-',
      plan:      p.membresia_id?.plan_id?.nombre || '-',
      monto:     p.monto,
      fecha_pago:p.fecha_pago,
      notas:     p.notas || '-',
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
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="pagos-pendientes.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// STOCK DE PRODUCTOS Excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stock/excel', async (req, res) => {
  try {
    const productos = await Producto.find().sort({ categoria: 1, nombre: 1 });

    const rows = productos.map(p => ({
      _num:        null,
      nombre:      p.nombre,
      categoria:   p.categoria || '-',
      precio_venta:p.precio_venta,
      stock:       p.stock,
      estado:      p.activo ? 'Activo' : 'Inactivo',
      descripcion: p.descripcion || '-',
    }));

    const headers = [
      { header: '#',           key: '_num',        width: 8  },
      { header: 'Producto',    key: 'nombre',      width: 28, align: 'left' },
      { header: 'Categoría',   key: 'categoria',   width: 20 },
      { header: 'Precio (S/)', key: 'precio_venta',width: 14, colorFn: () => 'FF16A34A' },
      { header: 'Stock',       key: 'stock',       width: 12, colorFn: v => parseInt(v) <= 5 ? 'FFCC0000' : 'FF16A34A' },
      { header: 'Estado',      key: 'estado',      width: 12, colorFn: v => v === 'Activo' ? 'FF16A34A' : 'FFCC0000' },
      { header: 'Descripción', key: 'descripcion', width: 36, align: 'left' },
    ];

    const wb = buildStyledWorkbook('REPORTE DE STOCK DE PRODUCTOS', 'Stock Productos', headers, rows, 'PeruGym - Centro de Entrenamiento y Fitness');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="stock-productos.xlsx"');
    await wb.xlsx.write(res);
    res.end();
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
      filter.apertura = {};
      if (from) filter.apertura.$gte = new Date(from);
      if (to)   filter.apertura.$lte = new Date(to);
    }

    const cajas = await Caja.find(filter)
      .populate('usuario_id', 'usuario')
      .sort({ apertura: -1 });

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
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="resumen-caja.xlsx"');
    await wb.xlsx.write(res);
    res.end();
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
      filter.fecha_venta = {};
      if (from) filter.fecha_venta.$gte = new Date(from);
      if (to)   filter.fecha_venta.$lte = new Date(to);
    }
    if (caja_id) filter.caja_id = caja_id;

    const ventas = await Venta.find(filter)
      .populate('cliente_id', 'nombre')
      .populate('items.producto_id', 'nombre')
      .sort({ fecha_venta: -1 });

    const rows = [];
    for (const v of ventas) {
      for (const item of v.items) {
        rows.push({
          _num:        null,
          id:          v._id.toString().slice(-6).toUpperCase(),
          cliente:     v.cliente_id?.nombre || '-',
          producto:    item.producto_id?.nombre || '-',
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
      { header: 'Cantidad',     key: 'cantidad',   width: 12 },
      { header: 'Precio Unit.', key: 'precio_unit',width: 16, colorFn: () => 'FF374151' },
      { header: 'Subtotal',     key: 'subtotal',   width: 16, colorFn: () => 'FF16A34A' },
      { header: 'Fecha',        key: 'fecha_venta',width: 22 },
    ];

    const wb = buildStyledWorkbook('REPORTE DE VENTAS', 'Ventas', headers, rows, extra);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ventas.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGOS PDF
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pagos/pdf', async (req, res) => {
  const { from, to } = req.query;
  try {
    const filter = {};
    if (from && to) {
      filter.fecha_pago = { $gte: new Date(from), $lte: new Date(to) };
    }

    const pagos = await Pago.find(filter)
      .populate('cliente_id', 'nombre')
      .populate({ path: 'membresia_id', populate: { path: 'plan_id', select: 'nombre' } })
      .sort({ fecha_pago: -1 });

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=pagos.pdf');
    doc.pipe(res);

    doc.fontSize(18).text('Reporte de Pagos', { align: 'center' });
    if (from && to) doc.fontSize(10).text(`Período: ${from} - ${to}`, { align: 'center' });
    doc.moveDown();

    const total = pagos.reduce((sum, p) => sum + parseFloat(p.monto), 0);
    doc.fontSize(12).text(`Total registros: ${pagos.length}  |  Total: S/. ${total.toFixed(2)}`);
    doc.moveDown();

    pagos.forEach(p => {
      doc.fontSize(10).text(
        `${p.fecha_pago?.toISOString?.().split('T')[0] || p.fecha_pago} | ${p.cliente_id?.nombre || '-'} | ${p.membresia_id?.plan_id?.nombre || '-'} | S/. ${p.monto} | ${p.metodo_pago} | ${p.estado}`
      );
    });

    doc.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
