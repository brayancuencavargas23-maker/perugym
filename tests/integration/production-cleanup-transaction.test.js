const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient, ObjectId, BSON } = require('mongoose').mongo;
const { buildManifest, reviewDatabase } = require('../../scripts/review-production-cleanup');
const { migrateInTransaction } = require('../../scripts/apply-production-cleanup');
const ids = Array.from({ length: 12 }, () => new ObjectId().toString());
const [oldClient, keepClient, unrelatedClient, oldMem, keepMem, orphanMem, unrelatedMem, oldPay, keepPay, orphanPay, unrelatedPay, plan] = ids;
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const member = (id, client, total, start, end, state) => ({ _id: id, cliente_id: client, plan_id: plan,
    monto_total: total, fecha_inicio: `${start}T00:00:00.000Z`, fecha_fin: `${end}T00:00:00.000Z`, estado: state, __v: 0 });
  const payment = (id, client, mem, total) => ({ _id: id, cliente_id: client, membresia_id: mem, monto: total,
    estado: 'pagado', metodo_pago: 'efectivo', fecha_pago: '2026-10-01T05:00:00.000Z' });
  const before = {
    clientes: [{ _id: oldClient, nombre: 'Ana' }, { _id: keepClient, nombre: 'Ana' }, { _id: unrelatedClient, nombre: 'Intacto' }],
    membresias: [member(oldMem, oldClient, 85, '2026-09-01', '2026-10-01', 'vencido'),
      member(keepMem, keepClient, 100, '2026-10-01', '2026-11-01', 'activo'),
      member(orphanMem, new ObjectId().toString(), 100, '2026-09-01', '2026-10-01', 'cancelado'),
      member(unrelatedMem, unrelatedClient, 23, '2026-10-01', '2026-11-01', 'activo')],
    pagos: [payment(oldPay, oldClient, oldMem, 85), payment(keepPay, keepClient, keepMem, 100),
      payment(orphanPay, null, orphanMem, 100), payment(unrelatedPay, unrelatedClient, unrelatedMem, 23)],
    plans: [{ _id: plan, nombre: 'Diario' }], auditoria_intacta: [{ _id: new ObjectId().toString(), texto: 'intacto' }],
  };
  const after = copy(before);
  after.clientes = after.clientes.filter(c => c._id !== oldClient);
  after.membresias = after.membresias.filter(m => ![oldMem, orphanMem].includes(m._id));
  const target = after.membresias.find(m => m._id === keepMem);
  target.monto_total = 185;
  target.fecha_inicio = before.membresias[0].fecha_inicio;
  target.periodos = before.membresias.slice(0, 2).map((m, i) => ({ _id: m._id, plan_id: plan, plan_nombre: 'Diario',
    fecha_inicio: m.fecha_inicio, fecha_fin: m.fecha_fin, duracion_dias: (Date.parse(m.fecha_fin) - Date.parse(m.fecha_inicio)) / 86400000,
    monto_total: m.monto_total, precio_base: null, descuento: null, habilitado: true, inicial: i === 0,
    usuario_id: null, registrado_en: m.fecha_inicio, condiciones_asistencia: { limite_semanal: null, limite_diario: 1 }, notas: 'Histórico' }));
  target.__v = 1;
  for (const p of after.pagos) {
    if ([oldPay, keepPay].includes(p._id)) Object.assign(p, { cliente_id: keepClient, membresia_id: keepMem, periodo_id: p.membresia_id });
    if (p._id === orphanPay) Object.assign(p, { membresia_id: null, periodo_id: null, notas: `Origen ${orphanMem}` });
  }
  const manifest = buildManifest(before, after, { clientes: new Set([oldClient]),
    membresias: new Set([oldMem, keepMem, orphanMem]), pagos: new Set([oldPay, keepPay, orphanPay]) });
  return { before, manifest };
}
function bson(value, key) {
  if (Array.isArray(value)) return value.map(item => bson(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v, k)]));
  if (typeof value === 'string' && (key === '_id' || key?.endsWith('_id')) && /^[a-f0-9]{24}$/.test(value)) return new ObjectId(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value);
  return value;
}
let server, client, db;
beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db('cleanup_test');
}, 60000);
afterEach(async () => { await db.dropDatabase(); });
afterAll(async () => { await client.close(); await server.stop(); });
async function seed(before) {
  for (const [name, docs] of Object.entries(before)) await db.collection(name).insertMany(bson(docs));
}

test('confirma todos los cambios juntos, conserva tipos BSON y registros intactos; repetir no escribe', async () => {
  const { before, manifest } = fixture();
  await seed(before);
  const backup = jest.fn(async data => expect(data.pagos).toHaveLength(4));
  const session = client.startSession();
  const result = await session.withTransaction(() => migrateInTransaction(db, manifest, Object.keys(before), session, backup),
    { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  await session.endSession();
  expect(backup).toHaveBeenCalledTimes(1);
  expect(result.summary.changedRecords).toBe(7);
  expect(result.summary.after.paidCents).toBe(30800);
  const mem = await db.collection('membresias').findOne({ _id: new ObjectId(keepMem) });
  expect(mem.periodos[0]._id).toBeInstanceOf(ObjectId);
  expect(mem.periodos[0].plan_id).toBeInstanceOf(ObjectId);
  expect(mem.periodos[0].fecha_fin).toBeInstanceOf(Date);
  expect((await reviewDatabase(db, manifest)).summary.alreadyApplied).toBe(7);
  const again = client.startSession();
  const repeated = await again.withTransaction(() => migrateInTransaction(db, manifest, Object.keys(before), again, async () => {}));
  await again.endSession();
  expect(repeated.summary.changedRecords).toBe(0);
});

test('un fallo después de escribir revierte la transacción completa', async () => {
  const { before, manifest } = fixture();
  await seed(before);
  let writes = 0;
  const wrapped = { databaseName: db.databaseName, collection: name => {
    const collection = db.collection(name);
    return { find: (...args) => collection.find(...args), deleteOne: (...args) => collection.deleteOne(...args),
      updateOne: (...args) => { if (++writes === 2) throw new Error('Fallo inyectado'); return collection.updateOne(...args); } };
  } };
  const session = client.startSession();
  await expect(session.withTransaction(() => migrateInTransaction(wrapped, manifest, Object.keys(before), session, async () => {}))).rejects.toThrow('Fallo inyectado');
  await session.endSession();
  expect(writes).toBe(2);
  expect((await reviewDatabase(db, manifest)).summary.ready).toBe(7);
  expect(await db.collection('clientes').countDocuments()).toBe(3);
});

test('un pago nuevo bloquea antes de generar respaldo o escribir', async () => {
  const { before, manifest } = fixture();
  await seed(before);
  await db.collection('pagos').insertOne({ _id: new ObjectId(), membresia_id: new ObjectId(keepMem), monto: 10 });
  const backup = jest.fn();
  const session = client.startSession();
  await expect(session.withTransaction(() => migrateInTransaction(db, manifest, Object.keys(before), session, backup))).rejects.toThrow(/conflictos/);
  await session.endSession();
  expect(backup).not.toHaveBeenCalled();
  expect(await db.collection('membresias').countDocuments()).toBe(4);
});
