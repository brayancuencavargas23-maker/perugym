const express = require('express');
const mongoose = require('mongoose');
const { verifyToken, requireRole } = require('../middleware/auth');
const Conteo = require('../models/ConteoInventario');
const Producto = require('../models/Producto');
const Movimiento = require('../models/MovimientoInventario');
const TransactionManager = require('../utils/TransactionManager');

const router = express.Router();
router.use(verifyToken);

function error(message, status = 400) { return Object.assign(new Error(message), { status }); }

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw error('Indica los productos que contaste.');
  if (items.length > 500) throw error('Un conteo puede incluir hasta 500 productos.');
  const vistos = new Set();
  items.forEach((item, i) => {
    const n = i + 1;
    if (!item || !mongoose.Types.ObjectId.isValid(String(item.producto_id))) throw error(`Producto inválido en el item ${n}.`);
    const key = String(item.producto_id);
    if (vistos.has(key)) throw error('Un producto no puede repetirse en el conteo.');
    vistos.add(key);
    if (!Number.isSafeInteger(item.stock_sistema) || item.stock_sistema < 0) throw error(`Stock del sistema inválido en el item ${n}.`);
    if (!Number.isSafeInteger(item.stock_contado) || item.stock_contado < 0) throw error(`Stock contado inválido en el item ${n} (entero no negativo).`);
  });
}

/**
 * Confirma un conteo físico: por cada producto, si el stock del sistema cambió
 * respecto al conteo, aplica un movimiento de ajuste con motivo automático
 * "Conteo físico #n" y deja el historial completo del conteo (diferencias incluidas).
 */
router.post('/conteos', requireRole('admin'), async (req, res) => {
  const { items, notas } = req.body || {};
  try { validarItems(items); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (notas != null && (typeof notas !== 'string' || notas.length > 500)) {
    return res.status(400).json({ error: 'Notas inválidas (máximo 500 caracteres).' });
  }

  try {
    const num = (await Conteo.countDocuments({})) + 1;
    const motivo = `Conteo físico #${num}`;
    const resultado = await TransactionManager.execute(async session => {
      const ids = items.map(i => i.producto_id);
      const productos = await Producto.find({ _id: { $in: ids } }).session(session);
      const porId = new Map(productos.map(p => [String(p._id), p]));

      const snapshot = items.map(item => {
        const p = porId.get(String(item.producto_id));
        if (!p || !p.activo) throw error('Uno de los productos del conteo ya no existe o está inactivo. Recarga y reintenta.', 409);
        return { item, p };
      });

      const conflictos = snapshot
        .filter(({ item, p }) => p.stock !== item.stock_sistema)
        .map(({ p }) => p.nombre);
      if (conflictos.length) {
        throw error(`El stock de ${conflictos.length} producto(s) cambió durante el conteo (${conflictos.slice(0, 3).join(', ')}${conflictos.length > 3 ? '…' : ''}). Reintenta.`, 409);
      }

      const itemsConteo = snapshot.map(({ item, p }) => ({
        producto_id: p._id,
        nombre: p.nombre,
        stock_sistema: item.stock_sistema,
        stock_contado: item.stock_contado,
        diferencia: item.stock_contado - item.stock_sistema,
      }));

      const ajustados = itemsConteo.filter(i => i.diferencia !== 0).length;
      const conteo = await Conteo.create([{
        items: itemsConteo,
        ajustados,
        sin_cambio: itemsConteo.length - ajustados,
        notas: notas ? String(notas).trim() || null : null,
        usuario_id: String(req.user.id),
        responsable: req.user.name || req.user.email || String(req.user.id),
      }], { session });

      const actualizados = [];
      const movimientos = [];
      try {
        for (const it of itemsConteo) {
          if (it.diferencia === 0) continue;
          const upd = await Producto.findOneAndUpdate(
            { _id: it.producto_id, activo: true, stock: it.stock_sistema },
            { $set: { stock: it.stock_contado } },
            { new: true, session }
          );
          if (!upd) throw error('El stock de un producto cambió mientras confirmabas el conteo. Reintenta.', 409);
          actualizados.push({ _id: it.producto_id, stock: it.stock_sistema });

          const [mov] = await Movimiento.create([{
            producto_id: it.producto_id,
            stock_anterior: it.stock_sistema,
            stock_nuevo: it.stock_contado,
            cantidad: it.diferencia,
            tipo: 'ajuste',
            motivo,
            usuario_id: String(req.user.id),
            responsable: req.user.name || req.user.email || String(req.user.id),
            conteo_id: conteo[0]._id,
          }], { session });
          movimientos.push(mov._id);
        }
      } catch (err) {
        if (!session) {
          for (const a of actualizados) {
            await Producto.updateOne({ _id: a._id }, { $set: { stock: a.stock } });
          }
          await Movimiento.deleteMany({ _id: { $in: movimientos } });
          await Conteo.deleteOne({ _id: conteo[0]._id });
        }
        throw err;
      }

      return { conteo: conteo[0], motivo, ajustados };
    });

    res.status(201).json({
      conteo: resultado.conteo,
      motivo: resultado.motivo,
      ajustados: resultado.ajustados,
      sin_cambio: resultado.conteo.sin_cambio,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/inventario/conteos — historial paginado
router.get('/conteos', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
  try {
    const [data, total] = await Promise.all([
      Conteo.find().sort({ fecha: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Conteo.countDocuments({}),
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/inventario/conteos/:id — detalle del conteo
router.get('/conteos/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Conteo inválido.' });
  try {
    const conteo = await Conteo.findById(req.params.id).lean();
    if (!conteo) return res.status(404).json({ error: 'Conteo no encontrado.' });
    res.json(conteo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
