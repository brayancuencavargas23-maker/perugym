const request = require('supertest');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');
const { app, auth, post, contrato } = require('../helpers/membresias-fixture');
const Membresia = require('../../models/Membresia');
const Pago = require('../../models/Pago');

beforeAll(setupTestDB, 60000);
afterEach(clearDatabase);
afterAll(teardownTestDB);

describe.each([false, true])('operaciones simultáneas; sin transacciones=%s', disabled => {
  beforeEach(() => { process.env.DISABLE_TRANSACTIONS = String(disabled); });
  afterEach(() => { delete process.env.DISABLE_TRANSACTIONS; });

  test('solo una renovación y un cargo por la misma versión', async () => {
    const f = await contrato();
    const results = await Promise.all(Array.from({ length: 5 }, () => post(f.url, f.body)));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(4);
    expect((await Membresia.findById(f.mem._id)).periodos).toHaveLength(2);
    expect(await Pago.countDocuments()).toBe(2);
  });

  test('dos abonos no exceden el saldo de un periodo', async () => {
    const f = await contrato();
    const renew = await post(f.url, { ...f.body, estado_pago: 'pendiente' }).expect(200);
    const results = await Promise.all(Array.from({ length: 5 }, () => post('/pagos/abono', {
      membresia_id: String(f.mem._id), periodo_id: renew.body.periodo._id,
      monto: 100, caja_id: String(f.caja._id),
    })));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.every(r => [201, 400, 409].includes(r.status))).toBe(true);
    const pagos = await Pago.find({ periodo_id: renew.body.periodo._id, estado: 'pagado' });
    expect(pagos.reduce((sum, p) => sum + p.monto, 0)).toBe(100);
  });

  test('un pago pendiente solo se confirma una vez', async () => {
    const f = await contrato();
    const renew = await post(f.url, { ...f.body, estado_pago: 'pendiente' }).expect(200);
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app)
      .put(`/api/pagos/${renew.body.pago._id}/confirmar`).set('Authorization', auth())
      .send({ caja_id: String(f.caja._id) })));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.every(r => [200, 400, 409].includes(r.status))).toBe(true);
    expect(await Pago.countDocuments({ periodo_id: renew.body.periodo._id, estado: 'pagado' })).toBe(1);
  });
});
