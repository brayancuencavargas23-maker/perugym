const router = require('express').Router();
const Asistencia = require('../models/Asistencia');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

function buildFilter(query) {
  const { cliente_id, fecha, from, to, estado, nombre } = query;
  const filter = {};
  const clienteFilter = {};

  if (cliente_id) filter.cliente_id = cliente_id;

  if (fecha) {
    const d = new Date(fecha);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    filter.fecha = { $gte: d, $lt: next };
  } else {
    if (from || to) {
      filter.fecha = {};
      if (from) filter.fecha.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to); toDate.setDate(toDate.getDate() + 1);
        filter.fecha.$lt = toDate;
      }
    }
  }

  if (estado === 'en_curso')   filter.salida = null;
  if (estado === 'completado') filter.salida = { $ne: null };

  return { filter, nombreSearch: nombre || null };
}

router.get('/', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const { filter, nombreSearch } = buildFilter(req.query);

  try {
    let query = Asistencia.find(filter)
      .populate('cliente_id', 'nombre foto_url');

    if (nombreSearch) {
      // Necesitamos filtrar por nombre del cliente después del populate
    }

    const all = await query.sort({ entrada: -1 });

    // Filtrar por nombre si aplica
    const filtered = nombreSearch
      ? all.filter(a => a.cliente_id?.nombre?.toLowerCase().includes(nombreSearch.toLowerCase()))
      : all;

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * limit, page * limit);

    // Stats del día actual
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const todayRecords = await Asistencia.find({ fecha: { $gte: today, $lt: tomorrow } });
    const stats = {
      total_hoy: todayRecords.length,
      en_curso: todayRecords.filter(a => !a.salida).length,
      promedio_min: (() => {
        const completed = todayRecords.filter(a => a.salida);
        if (!completed.length) return null;
        const avg = completed.reduce((sum, a) => sum + (a.salida - a.entrada), 0) / completed.length;
        return Math.round(avg / 60000);
      })(),
    };

    const data = paginated.map(a => ({
      ...a.toObject(),
      id: a._id,
      cliente_nombre: a.cliente_id?.nombre,
      foto_url: a.cliente_id?.foto_url,
    }));

    res.json({ data, total, page: parseInt(page), pages: Math.ceil(total / limit), stats });
  } catch (err) {
    console.error('Error GET /asistencia:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Exportar Excel
router.get('/export', async (req, res) => {
  const { filter, nombreSearch } = buildFilter(req.query);

  try {
    const all = await Asistencia.find(filter)
      .populate('cliente_id', 'nombre')
      .sort({ entrada: -1 });

    const filtered = nombreSearch
      ? all.filter(a => a.cliente_id?.nombre?.toLowerCase().includes(nombreSearch.toLowerCase()))
      : all;

    const rows = filtered.map(a => {
      const entrada = a.entrada ? a.entrada.toTimeString().slice(0, 5) : '-';
      const salida  = a.salida  ? a.salida.toTimeString().slice(0, 5)  : null;
      let duracion = 'En curso';
      if (a.salida) {
        const secs = Math.round((a.salida - a.entrada) / 1000);
        duracion = secs < 60 ? `${secs} seg` : `${Math.round(secs / 60)} min`;
      }
      return {
        cliente: a.cliente_id?.nombre || '-',
        fecha: a.fecha ? a.fecha.toISOString().split('T')[0] : a.entrada.toISOString().split('T')[0],
        entrada,
        salida: salida || '-',
        duracion,
      };
    });

    const ExcelJS = require('exceljs');
    const path = require('path');
    const fs = require('fs');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PeruGym Sistema';
    wb.created = new Date();

    const ws = wb.addWorksheet('Asistencias', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
    });

    ws.columns = [
      { key: 'A', width: 14 }, { key: 'B', width: 28 }, { key: 'C', width: 16 },
      { key: 'D', width: 14 }, { key: 'E', width: 14 }, { key: 'F', width: 16 },
    ];

    ws.getRow(1).height = 70;
    ws.getRow(2).height = 22;
    ws.getRow(3).height = 18;
    ws.getRow(4).height = 5;
    ws.getRow(5).height = 22;

    ws.mergeCells('A1:F1');
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2D2D' } };
    ws.getCell('A1').value = '     REPORTE CONSOLIDADO DE ASISTENCIAS';
    ws.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 8 };

    const logoPath = path.join(__dirname, '..', 'public', 'imagenes', 'index', 'WhatsApp Image 2026-04-12 at 7.00.32 PM.png');
    if (fs.existsSync(logoPath)) {
      const logoId = wb.addImage({ filename: logoPath, extension: 'png' });
      ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 95, height: 92 }, editAs: 'oneCell' });
    }

    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = 'PeruGym - Centro de Entrenamiento y Fitness';
    ws.getCell('A2').font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFFFC9A0' } };
    ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 9 };
    ws.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2D2D' } };

    ws.mergeCells('A3:F3');
    ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.getCell('A3').value = `Generado: ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}`;
    ws.getCell('A3').font = { size: 9, color: { argb: 'FF374151' } };
    ws.getCell('A3').alignment = { indent: 1 };

    ws.mergeCells('A4:F4');
    ws.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA0522D' } };

    const headers = ['#', 'Cliente', 'Fecha', 'Entrada', 'Salida', 'Duración'];
    const headerKeys = ['A', 'B', 'C', 'D', 'E', 'F'];
    headers.forEach((h, idx) => {
      const cell = ws.getCell(headerKeys[idx] + '5');
      cell.value = h;
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2D2D' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { top: { style: 'thin', color: { argb: 'FFA0522D' } }, bottom: { style: 'thin', color: { argb: 'FFA0522D' } }, left: { style: 'thin', color: { argb: 'FFA0522D' } }, right: { style: 'thin', color: { argb: 'FFA0522D' } } };
    });

    rows.forEach((r, i) => {
      const rowNum = 6 + i;
      ws.getRow(rowNum).height = 18;
      const bgColor = i % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
      const values = [i + 1, r.cliente, r.fecha, r.entrada, r.salida, r.duracion];
      values.forEach((val, idx) => {
        const cell = ws.getCell(headerKeys[idx] + rowNum);
        cell.value = val;
        cell.font = { name: 'Calibri', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.alignment = { vertical: 'middle', horizontal: idx <= 1 ? 'left' : 'center' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } }, right: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        if (idx === 5) {
          if (val === 'En curso') cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF6B2020' } };
          else if (val.includes('seg')) cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFA16207' } };
          else cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF16A34A' } };
        }
      });
    });

    const totalRowNum = 6 + rows.length;
    ws.mergeCells('A' + totalRowNum + ':F' + totalRowNum);
    const totalCell = ws.getCell('A' + totalRowNum);
    totalCell.value = 'Total de registros: ' + rows.length;
    totalCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2D2D' } };
    totalCell.alignment = { vertical: 'middle', horizontal: 'right' };
    ws.getRow(totalRowNum).height = 20;

    ws.headerFooter.oddFooter = '&LPeruGym - Sistema de Gestion&C&"Calibri,Italic"Reporte generado automaticamente&RPagina &P de &N';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="asistencias.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error export Excel:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/checkin', async (req, res) => {
  const { cliente_id } = req.body;
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const existing = await Asistencia.findOne({
      cliente_id,
      fecha: { $gte: today, $lt: tomorrow },
      salida: null,
    });
    if (existing) return res.status(400).json({ error: 'El cliente ya tiene un check-in activo hoy' });

    const created = await Asistencia.create({ cliente_id });
    // Populate para devolver el mismo shape que GET /asistencia
    const asistencia = await Asistencia.findById(created._id)
      .populate('cliente_id', 'nombre foto_url');

    res.status(201).json({
      ...asistencia.toObject(),
      id: asistencia._id,
      cliente_nombre: asistencia.cliente_id?.nombre,
      foto_url: asistencia.cliente_id?.foto_url,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/checkout/:id', async (req, res) => {
  try {
    const asistencia = await Asistencia.findByIdAndUpdate(
      req.params.id,
      { salida: new Date() },
      { new: true }
    ).populate('cliente_id', 'nombre foto_url');

    // Devolver con el mismo shape que GET /asistencia para que el patch del caché funcione
    res.json({
      ...asistencia.toObject(),
      id: asistencia._id,
      cliente_nombre: asistencia.cliente_id?.nombre,
      foto_url: asistencia.cliente_id?.foto_url,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/checkout/cliente/:cliente_id', async (req, res) => {
  try {
    const active = await Asistencia.findOne({ cliente_id: req.params.cliente_id, salida: null })
      .sort({ entrada: -1 });
    if (!active) return res.status(404).json({ error: 'No hay check-in activo' });

    const asistencia = await Asistencia.findByIdAndUpdate(
      active._id,
      { salida: new Date() },
      { new: true }
    ).populate('cliente_id', 'nombre foto_url');

    res.json({
      ...asistencia.toObject(),
      id: asistencia._id,
      cliente_nombre: asistencia.cliente_id?.nombre,
      foto_url: asistencia.cliente_id?.foto_url,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
