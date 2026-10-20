const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../models/Usuario', () => ({ findOne: jest.fn() }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('bcryptjs', () => ({ compare: jest.fn().mockResolvedValue(true) }));
const Usuario = require('../../models/Usuario');
const { OAuth2Client } = require('google-auth-library');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../../routes/auth'));

const user = { _id: '507f1f77bcf86cd799439011', usuario: 'Recepción', email: 'permitido@gmail.com', rol: 'recepcionista', permisos: ['caja'], password: 'hash' };
let oauth;
let errorLog;
const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  require('bcryptjs').compare.mockResolvedValue(true);
  process.env.JWT_SECRET = 'test-google-secret';
  process.env.JWT_EXPIRES_IN = '12h';
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';
  oauth = { generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/test'),
    getToken: jest.fn().mockResolvedValue({ tokens: { id_token: 'google-id-token' } }), verifyIdToken: jest.fn() };
  OAuth2Client.mockImplementation(() => oauth);
  Usuario.findOne.mockResolvedValue(user);
});
afterEach(() => { errorLog.mockRestore(); });
afterAll(() => { process.env = originalEnv; });

async function begin() {
  const res = await request(app).get('/api/auth/google');
  const cookie = res.headers['set-cookie'].find(c => c.startsWith('gym_google_state=')).split(';')[0];
  const data = jwt.verify(decodeURIComponent(cookie.split('=')[1]), process.env.JWT_SECRET, { audience: 'google-state' });
  return { cookie, data };
}

function identity(data, overrides = {}) {
  oauth.verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: 'google-user', email: user.email,
    email_verified: true, nonce: data.nonce, ...overrides }) });
}

test('inicio usa callback configurado, PKCE, nonce y cookie HttpOnly', async () => {
  const { data } = await begin();
  expect(OAuth2Client).toHaveBeenCalledWith('test-client', 'test-secret', process.env.GOOGLE_CALLBACK_URL);
  expect(oauth.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({ state: data.state, nonce: data.nonce, code_challenge_method: 'S256' }));
  const res = await request(app).get('/api/auth/google');
  expect(res.headers['set-cookie'].join(';')).toContain('HttpOnly');
  expect(res.headers.location).toBe('https://accounts.google.com/test');
});

test('estado incorrecto rechaza antes de intercambiar el código', async () => {
  const { cookie } = await begin();
  const res = await request(app).get('/api/auth/google/callback?code=code&state=incorrecto').set('Cookie', cookie);
  expect(res.headers.location).toBe('/login.html?google_error=failed');
  expect(oauth.getToken).not.toHaveBeenCalled();
});

test.each([
  ['nonce distinto', { nonce: 'otro' }],
  ['correo no verificado', { email_verified: false }],
  ['dominio distinto', { email: 'permitido@example.com' }],
])('rechaza %s', async (_name, overrides) => {
  const { cookie, data } = await begin();
  identity(data, overrides);
  const res = await request(app).get('/api/auth/google/callback').query({ code: 'code', state: data.state }).set('Cookie', cookie);
  expect(res.headers.location).toBe('/login.html?google_error=denied');
  expect(Usuario.findOne).not.toHaveBeenCalled();
});

test('Gmail no registrado o inactivo no obtiene sesión', async () => {
  const { cookie, data } = await begin();
  identity(data);
  Usuario.findOne.mockResolvedValue(null);
  const res = await request(app).get('/api/auth/google/callback').query({ code: 'code', state: data.state }).set('Cookie', cookie);
  expect(Usuario.findOne).toHaveBeenCalledWith({ email: user.email, activo: true });
  expect(res.headers.location).toBe('/login.html?google_error=denied');
});

test('callback válido entrega sesión corta sin tokens en la URL y con permisos locales', async () => {
  const { cookie, data } = await begin();
  identity(data);
  const res = await request(app).get('/api/auth/google/callback').query({ code: 'code', state: data.state }).set('Cookie', cookie);
  expect(res.headers.location).toBe('/login.html?google=success');
  expect(oauth.getToken).toHaveBeenCalledWith({ code: 'code', codeVerifier: data.verifier });
  expect(oauth.verifyIdToken).toHaveBeenCalledWith({ idToken: 'google-id-token', audience: 'test-client' });
  const result = res.headers['set-cookie'].find(c => c.startsWith('gym_google_result=')).split(';')[0];
  const complete = await request(app).post('/api/auth/google/complete').set('Cookie', result);
  expect(complete.status).toBe(200);
  const payload = jwt.verify(complete.body.token, process.env.JWT_SECRET);
  expect(payload.exp - payload.iat).toBe(12 * 60 * 60);
  expect(payload.permisos).toEqual(['caja']);
});

test('no completa sin resultado temporal ni si el usuario se desactiva', async () => {
  expect((await request(app).post('/api/auth/google/complete')).status).toBe(401);
  const result = jwt.sign({ id: user._id, purpose: 'google-result' }, process.env.JWT_SECRET, { audience: 'google-result', expiresIn: '1m' });
  Usuario.findOne.mockResolvedValue(null);
  expect((await request(app).post('/api/auth/google/complete').set('Cookie', `gym_google_result=${result}`)).status).toBe(401);
});

test('login usa correo normalizado, no nombre de usuario', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: ' Permitido@Gmail.com ', password: 'password' });
  expect(res.status).toBe(200);
  expect(Usuario.findOne).toHaveBeenCalledWith({ email: user.email, activo: true });
  expect((await request(app).post('/api/auth/login').send({ username: 'Recepción', password: 'password' })).status).toBe(400);
});

test('configuración incompleta muestra error recuperable en login', async () => {
  delete process.env.GOOGLE_CLIENT_SECRET;
  const res = await request(app).get('/api/auth/google');
  expect(res.headers.location).toBe('/login.html?google_error=config');
  const diagnostic = JSON.parse(errorLog.mock.calls[0][0]);
  expect(diagnostic.stage).toBe('configuration');
  expect(diagnostic.reason).toBe('GOOGLE_CONFIG_MISSING');
  expect(diagnostic.variables.GOOGLE_CLIENT_SECRET).toBe('missing');
});

test('callback inválido identifica la causa sin imprimir configuración privada', async () => {
  process.env.GOOGLE_CALLBACK_URL = 'http://production.example/api/auth/google/callback';
  const res = await request(app).get('/api/auth/google');
  expect(res.headers.location).toBe('/login.html?google_error=config');
  const log = errorLog.mock.calls[0][0];
  expect(JSON.parse(log).reason).toBe('GOOGLE_CALLBACK_INVALID');
  expect(log).not.toContain(process.env.GOOGLE_CLIENT_SECRET);
  expect(log).not.toContain(process.env.JWT_SECRET);
  expect(log).not.toContain(process.env.GOOGLE_CALLBACK_URL);
});

test('distingue fallo de librería de variables ausentes sin registrar mensajes con secretos', async () => {
  oauth.generateAuthUrl.mockImplementation(() => { throw new Error(process.env.GOOGLE_CLIENT_SECRET); });
  const res = await request(app).get('/api/auth/google');
  expect(res.headers.location).toBe('/login.html?google_error=config');
  const log = errorLog.mock.calls[0][0];
  expect(JSON.parse(log)).toEqual(expect.objectContaining({ stage: 'authorization_url', reason: 'OAUTH_START_ERROR' }));
  expect(log).not.toContain(process.env.GOOGLE_CLIENT_SECRET);
});
