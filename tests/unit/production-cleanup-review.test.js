const { buildManifest, verifyManifest, reviewDatabase, parseArgs } = require('../../scripts/review-production-cleanup');
const copy = value => JSON.parse(JSON.stringify(value));
const oldClient = '111111111111111111111111', keptClient = '222222222222222222222222';
const oldMem = '333333333333333333333333', keptMem = '444444444444444444444444';
const paymentId = '555555555555555555555555', planId = '666666666666666666666666';
function fixture() {
  const before = { clientes: [{ _id: oldClient, nombre: 'Ana' }, { _id: keptClient, nombre: 'Ana' }],
    membresias: [{ _id: oldMem, cliente_id: oldClient, plan_id: planId }, { _id: keptMem, cliente_id: keptClient, plan_id: planId }],
    pagos: [{ _id: paymentId, cliente_id: oldClient, membresia_id: oldMem, monto: 85, estado: 'pagado' }],
    plans: [{ _id: planId, nombre: 'Plan' }], ventas: [{ _id: 'venta-intacta', monto: 15 }] };
  const after = copy(before);
  after.clientes.shift();
  after.membresias.shift();
  after.membresias[0].periodos = [{ _id: oldMem, monto_total: 85 }];
  Object.assign(after.pagos[0], { cliente_id: keptClient, membresia_id: keptMem, periodo_id: oldMem });
  const allowed = { clientes: new Set([oldClient]), membresias: new Set([oldMem, keptMem]), pagos: new Set([paymentId]) };
  return { before, after, allowed, manifest: buildManifest(before, after, allowed) };
}
function readOnlyDb(data) {
  return { databaseName: 'prueba-aislada',
    listCollections: () => ({ toArray: async () => Object.keys(data).map(name => ({ name })) }),
    collection: name => ({ find: query => {
      expect(query.$or.length).toBeGreaterThan(0);
      const matches = doc => query.$or.some(clause => Object.entries(clause).some(([field, rule]) => rule.$in.some(value => String(value) === String(doc[field]))));
      return { toArray: async () => copy((data[name] || []).filter(matches)) };
    } }) };
}

test('congela únicamente cambios y rechaza modificaciones ajenas o financieras', () => {
  const { before, after, allowed, manifest } = fixture();
  expect(manifest.operations).toHaveLength(4);
  expect(manifest.operations.some(op => op.collection === 'ventas')).toBe(false);
  const unexpected = copy(after);
  unexpected.ventas[0].monto = 30;
  expect(() => buildManifest(before, unexpected, allowed)).toThrow(/no aprobado/);
  const changedMoney = copy(after);
  changedMoney.pagos[0].monto = 90;
  expect(() => buildManifest(before, changedMoney, allowed)).toThrow();
});

test('marca el plan como listo y omite registros intactos del informe', async () => {
  const { before, manifest } = fixture();
  const report = await reviewDatabase(readOnlyDb(before), manifest);
  expect(report.summary).toMatchObject({ ready: 4, conflicts: 0, dependencyConflicts: 0, compatibleWithPlan: true });
  expect(report.operations.some(op => op.id === keptClient)).toBe(false);
  expect(report.operations.some(op => op.collection === 'plans')).toBe(false);
});

test('reconoce una migración ya aplicada sin proponer duplicarla', async () => {
  const { after, manifest } = fixture();
  const report = await reviewDatabase(readOnlyDb(after), manifest);
  expect(report.summary).toMatchObject({ alreadyApplied: 4, ready: 0, conflicts: 0, compatibleWithPlan: true });
});

test('detecta pagos nuevos y referencias en colecciones nuevas', async () => {
  const { before, manifest } = fixture();
  const live = copy(before);
  live.pagos.push({ _id: 'nuevo-pago', membresia_id: keptMem, monto: 20 });
  live.asistencias = [{ _id: 'nueva-asistencia', cliente_id: keptClient, membresia_id: oldMem }];
  const report = await reviewDatabase(readOnlyDb(live), manifest);
  expect(report.summary.compatibleWithPlan).toBe(false);
  expect(report.dependencyConflicts.map(item => item.collection).sort()).toEqual(['asistencias', 'pagos']);
});

test('detecta cambios posteriores en registros afectados y en planes relacionados', async () => {
  const { before, manifest } = fixture();
  const live = copy(before);
  live.membresias[1].fecha_fin = '2026-12-01';
  live.plans[0].nombre = 'Plan editado';
  const report = await reviewDatabase(readOnlyDb(live), manifest);
  expect(report.summary.conflicts).toBe(1);
  expect(report.dependencyConflicts).toEqual(expect.arrayContaining([expect.objectContaining({ collection: 'plans', reason: 'related_record_changed' })]));
});

test('rechaza un manifiesto alterado y cualquier opción para aplicar cambios', () => {
  const { manifest } = fixture();
  manifest.operations[0].after = { _id: oldClient };
  expect(() => verifyManifest(manifest)).toThrow(/modificado/);
  expect(() => parseArgs(['--apply'])).toThrow(/no permitida/);
});
