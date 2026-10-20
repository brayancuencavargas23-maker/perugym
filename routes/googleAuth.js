const router = require('express').Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const Usuario = require('../models/Usuario');

const STATE_COOKIE = 'gym_google_state';
const RESULT_COOKIE = 'gym_google_result';
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

function options() {
  return { httpOnly: true, secure: process.env.GOOGLE_CALLBACK_URL?.startsWith('https://') || false,
    sameSite: 'lax', path: '/api/auth/google' };
}

function cookie(req, name) {
  const entry = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function client() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, JWT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL || !JWT_SECRET) throw new Error('Google no configurado');
  const url = new URL(GOOGLE_CALLBACK_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Callback inválido');
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL);
}

router.use((_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

router.get('/', (req, res) => {
  try {
    const oauth = client();
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    res.clearCookie(RESULT_COOKIE, options());
    res.cookie(STATE_COOKIE, jwt.sign({ purpose: 'google-state', state, nonce, verifier }, process.env.JWT_SECRET,
      { expiresIn: '10m', audience: 'google-state' }), { ...options(), maxAge: 600000 });
    res.redirect(oauth.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce,
      prompt: 'select_account', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }));
  } catch {
    res.redirect('/login.html?google_error=config');
  }
});

router.get('/callback', async (req, res) => {
  res.clearCookie(STATE_COOKIE, options());
  try {
    const oauth = client();
    const saved = jwt.verify(cookie(req, STATE_COOKIE), process.env.JWT_SECRET, { audience: 'google-state', algorithms: ['HS256'] });
    if (saved.purpose !== 'google-state' || typeof req.query.state !== 'string' || saved.state !== req.query.state) throw new Error('Estado inválido');
    if (req.query.error) return res.redirect('/login.html?google_error=cancelled');
    if (typeof req.query.code !== 'string') throw new Error('Código inválido');
    const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: saved.verifier });
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = ticket.getPayload();
    const email = normalizeEmail(identity?.email);
    if (identity?.nonce !== saved.nonce || identity?.email_verified !== true || !identity?.sub || !email.endsWith('@gmail.com')) {
      return res.redirect('/login.html?google_error=denied');
    }
    // No crea cuentas ni concede permisos desde Google: autorización propia de PeruGym.
    const user = await Usuario.findOne({ email, activo: true });
    if (!user) return res.redirect('/login.html?google_error=denied');
    // Entrega temporal HttpOnly: ningún token de sesión viaja en la URL.
    res.cookie(RESULT_COOKIE, jwt.sign({ purpose: 'google-result', id: String(user._id) }, process.env.JWT_SECRET,
      { expiresIn: '1m', audience: 'google-result' }), { ...options(), maxAge: 60000 });
    res.redirect('/login.html?google=success');
  } catch {
    res.clearCookie(RESULT_COOKIE, options());
    res.redirect('/login.html?google_error=failed');
  }
});

router.post('/complete', async (req, res) => {
  res.clearCookie(RESULT_COOKIE, options());
  try {
    const saved = jwt.verify(cookie(req, RESULT_COOKIE), process.env.JWT_SECRET, { audience: 'google-result', algorithms: ['HS256'] });
    if (saved.purpose !== 'google-result') throw new Error('Resultado inválido');
    const user = await Usuario.findOne({ _id: saved.id, activo: true });
    if (!user) return res.status(401).json({ error: 'Cuenta no autorizada' });
    const payload = { id: String(user._id), name: user.usuario, email: user.email, role: user.rol,
      permisos: user.rol === 'admin' ? [] : (user.permisos || []) };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
    res.json({ token, user: payload });
  } catch {
    res.status(401).json({ error: 'No se pudo completar el acceso con Google. Intenta nuevamente.' });
  }
});

module.exports = router;
