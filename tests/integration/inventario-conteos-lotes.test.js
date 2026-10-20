const express = require('express');
const request = require('supertest');
const { setupTestDB, teardownTestDB, clearDatabase, createAuthToken } = require('../helpers/setup');

const Producto = require('../../models/Producto');
const Lote = require('../../models/Lote');
const Conteo = require('../../models/ConteoInventario');
const Movimiento = require('../../models/MovimientoInventario');

const app = express();
app.use(express.json());
app.use('/api/productos', require('../../routes/productos'));
app.use('/api/inventario', require('../../routes/inventario'));
app.use('/api/dashboard', require('../../routes/dashboard'));

const admin = `Bearer ${createAuthToken({ id: 'dev', role: 'admin', name: 'Ana Admin' })}`;
const recep = `Bearer ${createAuthToken({ id: 'dev', role: 'recepcionista', name: 'Luis Op' })}`;

beforeAll(async () => { await setupTestDB(); }, 60000);
afterEach(clearDatabase);
afterAll(teardownTestDB);

const crearProducto = async (extra = {}) => {
  const res = await request(app)
    .post('/api/productos')
    .set('Authorization', admin)
    .send({ nombre: 'Producto X', precio_venta: 50, stock: 0, ...extra })
    .expect(201);
  return res.body;
};

// ── Código de barras ─────────────────────────────────────────────────────────
test('código de barras: crear, buscar, validar y limpiar', async () => {
  const p = await crearProducto({ nombre: 'Guantes', codigo_barras: '77512345' });
  expect(p.codigo_barras).toBe('77512345');

  // Búsqueda por código (lector de barras)
  const found = await request(app).get('/api/productos?search=77512345').set('Authorization', admin).expect(200);
  expect(found.body.data).toHaveLength(1);
  expect(found.body.data[0].nombre).toBe('Guantes');

  // Duplicado rechazado
  const dup = await request(app).post('/api/productos').set('Authorization', admin)
    .send({ nombre: 'Otro', precio_venta: 10, codigo_barras: '77512345' }).expect(400);
  expect(dup.body.error).toMatch(/ya está registrado/i);

  // Caracteres inválidos
  const invalido = await request(app).post('/api/productos').set('Authorization', admin)
    .send({ nombre: 'Raro', precio_venta: 10, codigo_barras: 'abc@#$' }).expect(400);
  expect(invalido.body.error).toMatch(/código de barras/i);

  // Editar código; duplicado sobre otro producto rechazado
  const q = await crearProducto({ nombre: 'Toalla', codigo_barras: '999000' });
  const upd = await request(app).put(`/api/productos/${p._id}`).set('Authorization', admin)
    .send({ codigo_barras: '555666' }).expect(200);
  expect(upd.body.codigo_barras).toBe('555666');
  await request(app).put(`/api/productos/${q._id}`).set('Authorization', admin)
    .send({ codigo_barras: '555666' }).expect(400);

  // Limpiar el código con vacío
  const limpio = await request(app).put(`/api/productos/${p._id}`).set('Authorization', admin)
    .send({ codigo_barras: '' }).expect(200);
  expect(limpio.body.codigo_barras).toBeNull();
});

// ── Lotes (trazabilidad) ─────────────────────────────────────────────────────
test('lotes: CRUD con validaciones y permisos', async () => {
  const p = await crearProducto({ nombre: 'Barra energética', stock: 10 });

  // Validaciones
  await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', admin)
    .send({ cantidad: 0, fecha_vencimiento: '2027-01-01' }).expect(400);
  await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', admin)
    .send({ cantidad: 5, fecha_vencimiento: 'no-fecha' }).expect(400);
  await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', recep)
    .send({ cantidad: 5, fecha_vencimiento: '2027-01-01' }).expect(403);

  // Crear dos lotes
  const l1 = await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', admin)
    .send({ numero_lote: 'L-001', cantidad: 5, fecha_vencimiento: '2027-01-01' }).expect(201);
  const l2 = await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', admin)
    .send({ cantidad: 3, fecha_vencimiento: '2026-11-01' }).expect(201);
  expect(l1.body.numero_lote).toBe('L-001');
  expect(l2.body.numero_lote).toBeNull();
  expect(l2.body.responsable).toBe('Ana Admin');

  // Lista ordenada por vencimiento (sin tocar el stock)
  const lista = await request(app).get(`/api/productos/${p._id}/lotes`).set('Authorization', recep).expect(200);
  expect(lista.body.total).toBe(2);
  expect(new Date(lista.body.data[0].fecha_vencimiento) < new Date(lista.body.data[1].fecha_vencimiento)).toBe(true);
  expect((await Producto.findById(p._id)).stock).toBe(10);

  // Eliminar lote propio y de otro producto → 404
  const otro = await crearProducto({ nombre: 'Otro producto' });
  await request(app).delete(`/api/productos/${otro._id}/lotes/${l1.body._id}`).set('Authorization', admin).expect(404);
  await request(app).delete(`/api/productos/${p._id}/lotes/${l1.body._id}`).set('Authorization', admin).expect(200);
  expect(await Lote.countDocuments()).toBe(1);
  expect((await Producto.findById(p._id)).stock).toBe(10);

  // Producto inactivo no admite lotes nuevos
  await request(app).delete(`/api/productos/${p._id}`).set('Authorization', admin).expect(200);
  await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', admin)
    .send({ cantidad: 2, fecha_vencimiento: '2027-06-01' }).expect(400);
});

// ── Conteo físico ────────────────────────────────────────────────────────────
test('conteo físico: aplica ajustes con motivo automático y deja historial', async () => {
  const a = await crearProducto({ nombre: 'Proteína', stock: 10 });
  const b = await crearProducto({ nombre: 'Creatina', stock: 5 });

  const res = await request(app).post('/api/inventario/conteos').set('Authorization', admin)
    .send({
      items: [
        { producto_id: a._id, stock_sistema: 10, stock_contado: 12 },
        { producto_id: b._id, stock_sistema: 5, stock_contado: 5 },
      ],
      notas: 'Conteo de quincena',
    })
    .expect(201);
  expect(res.body.ajustados).toBe(1);
  expect(res.body.sin_cambio).toBe(1);
  expect(res.body.motivo).toBe('Conteo físico #1');

  // Stocks aplicados: A ajustado, B intacto
  expect((await Producto.findById(a._id)).stock).toBe(12);
  expect((await Producto.findById(b._id)).stock).toBe(5);

  // Movimiento de ajuste ligado al conteo
  const movs = await Movimiento.find({ producto_id: a._id, tipo: 'ajuste' });
  expect(movs).toHaveLength(1);
  expect(movs[0].tipo).toBe('ajuste');
  expect(movs[0].motivo).toBe('Conteo físico #1');
  expect(movs[0].stock_anterior).toBe(10);
  expect(movs[0].stock_nuevo).toBe(12);
  expect(movs[0].cantidad).toBe(2);
  expect(String(movs[0].conteo_id)).toBe(res.body.conteo._id);
  expect(await Movimiento.countDocuments({ producto_id: b._id, tipo: 'ajuste' })).toBe(0);

  // Historial y detalle
  const lista = await request(app).get('/api/inventario/conteos').set('Authorization', admin).expect(200);
  expect(lista.body.total).toBe(1);
  expect(lista.body.data[0].ajustados).toBe(1);
  expect(lista.body.data[0].responsable).toBe('Ana Admin');
  expect(lista.body.data[0].notas).toBe('Conteo de quincena');

  const det = await request(app).get(`/api/inventario/conteos/${res.body.conteo._id}`).set('Authorization', admin).expect(200);
  expect(det.body.items).toHaveLength(2);
  const itemA = det.body.items.find(i => i.nombre === 'Proteína');
  expect(itemA.diferencia).toBe(2);

  // Segundo conteo → número correlativo
  const res2 = await request(app).post('/api/inventario/conteos').set('Authorization', admin)
    .send({ items: [{ producto_id: a._id, stock_sistema: 12, stock_contado: 11 }] })
    .expect(201);
  expect(res2.body.motivo).toBe('Conteo físico #2');
  expect((await Producto.findById(a._id)).stock).toBe(11);
});

test('conteo físico: validaciones, conflicto de stock y permisos', async () => {
  const a = await crearProducto({ nombre: 'Barra', stock: 7 });

  await request(app).post('/api/inventario/conteos').set('Authorization', admin)
    .send({ items: [] }).expect(400);
  await request(app).post('/api/inventario/conteos').set('Authorization', admin)
    .send({ items: [{ producto_id: a._id, stock_sistema: 7, stock_contado: -1 }] }).expect(400);
  await request(app).post('/api/inventario/conteos').set('Authorization', admin)
    .send({ items: [{ producto_id: 'no-es-id', stock_sistema: 0, stock_contado: 0 }] }).expect(400);
  await request(app).post('/api/inventario/conteos').set('Authorization', recep)
    .send({ items: [{ producto_id: a._id, stock_sistema: 7, stock_contado: 9 }] }).expect(403);

  // El stock del sistema del snapshot no coincide con el actual → 409, nada aplicado
  const conflicto = await request(app).post('/api/inventario/conteos').set('Authorization', admin)
    .send({ items: [{ producto_id: a._id, stock_sistema: 99, stock_contado: 10 }] })
    .expect(409);
  expect(conflicto.body.error).toMatch(/cambió/i);
  expect((await Producto.findById(a._id)).stock).toBe(7);
  expect(await Conteo.countDocuments()).toBe(0);
  expect(await Movimiento.countDocuments({ tipo: 'ajuste' })).toBe(0);

  // Producto inexistente/inactivo → 409
  await request(app).delete(`/api/productos/${a._id}`).set('Authorization', admin).expect(200);
  await request(app).post('/api/inventario/conteos').set('Authorization', admin)
    .send({ items: [{ producto_id: a._id, stock_sistema: 7, stock_contado: 7 }] }).expect(409);

  // El historial de conteos es visible para recepcionista (solo lectura)
  await request(app).get('/api/inventario/conteos').set('Authorization', recep).expect(200);
});

// ── Alertas de vencimiento ───────────────────────────────────────────────────
test('alertas: lotes vencidos y por vencer en notificaciones y panel', async () => {
  const p = await crearProducto({ nombre: 'Pre entreno', stock: 20 });
  const fmt = require('../../utils/reportDates').limaDate;
  const ayer = new Date(Date.now() - 86400000);
  const futuro = new Date(Date.now() + 10 * 86400000);

  await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', admin)
    .send({ numero_lote: 'V-1', cantidad: 6, fecha_vencimiento: fmt(ayer) }).expect(201);
  await request(app).post(`/api/productos/${p._id}/lotes`).set('Authorization', admin)
    .send({ numero_lote: 'P-1', cantidad: 8, fecha_vencimiento: fmt(futuro) }).expect(201);

  // Notificaciones del campanita
  const notif = await request(app).get('/api/dashboard/notifications').set('Authorization', admin).expect(200);
  const tipos = notif.body.items.map(n => n.tipo);
  expect(tipos).toContain('lote_vencido');
  expect(tipos).toContain('lote_por_vencer');
  const vencida = notif.body.items.find(n => n.tipo === 'lote_vencido');
  expect(vencida.detalle).toContain('V-1');
  expect(vencida.prioridad).toBe('alta');

  // Datos del panel lateral
  const low = await request(app).get('/api/dashboard/low-stock').set('Authorization', admin).expect(200);
  expect(low.body.lotes).toHaveLength(2);
  const vencido = low.body.lotes.find(l => l.vencido);
  const porVencer = low.body.lotes.find(l => !l.vencido);
  expect(vencido.numero_lote).toBe('V-1');
  expect(vencido.producto).toBe('Pre entreno');
  expect(porVencer.dias).toBeGreaterThan(0);
  expect(porVencer.dias).toBeLessThanOrEqual(30);
  expect(porVencer.fecha_vencimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
