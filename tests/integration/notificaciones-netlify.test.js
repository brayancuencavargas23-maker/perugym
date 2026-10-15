jest.mock('../../config/database', () => ({ connectDB: async () => {} }));
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { clearDatabase, createAuthToken } = require('../helpers/setup');
const Solicitud = require('../../models/Solicitud');
const Plan = require('../../models/Plan');
const Leida = require('../../models/NotificacionLeida');
const { handler } = require('../../netlify/functions/api');
const auth = `Bearer ${createAuthToken({ id: 'dev', role: 'admin' })}`;
let db;
beforeAll(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Leida.init();
}, 60000);
afterEach(clearDatabase);
afterAll(async () => { await mongoose.disconnect(); await db.stop(); });
async function call(method, endpoint, body) {
  const response = await handler({ httpMethod: method, path: '/api/dashboard/notifications' + endpoint,
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : null, isBase64Encoded: false, queryStringParameters: {} }, {});
  expect(response.statusCode).toBe(200);
  const text = response.isBase64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
  return JSON.parse(text);
}

test('la entrada Netlify guarda la lectura y el siguiente GET mantiene el contador en cero', async () => {
  const plan = await Plan.create({ nombre: 'Mensual', precio: 100, duracion_dias: 30 });
  await Solicitud.create({ nombre: 'Ana', telefono: '999888777', plan_id: plan._id });
  const first = await call('GET', '');
  expect(first.no_leidas).toBe(1);
  expect((await call('POST', '/read', { claves: first.items.map(n => n.clave) })).no_leidas).toBe(0);
  expect((await call('GET', '')).no_leidas).toBe(0);
  expect(await Leida.countDocuments({ usuario_id: 'dev' })).toBe(1);
});
