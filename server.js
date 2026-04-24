require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fileUpload = require('express-fileupload');
const path = require('path');
const { initDB } = require('./config/database');

const app = express();

// ── Seguridad: headers HTTP ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],      // <script> blocks inline
      scriptSrcAttr: ["'unsafe-inline'"],                // onclick/onchange/etc. en atributos HTML
      styleSrc:      ["'self'", "'unsafe-inline'"],
      imgSrc:        ["'self'", "data:", "https://res.cloudinary.com", "blob:"],
      connectSrc:    ["'self'"],
      fontSrc:       ["'self'", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false, // evita romper imágenes de Cloudinary
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'],
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: { error: 'Demasiados intentos de inicio de sesión. Espera 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
// Solo aplica al login
app.use('/api/auth/login', loginLimiter);

// ── Body parsers y archivos ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } }));
app.use(express.static(path.join(__dirname, 'public')));

const { noCache } = require('./middleware/auth');

// ── Headers anti-caché para páginas protegidas del panel ─────────────────────
// Impide que el navegador cachee el HTML tras el logout (botón "atrás")
const PROTECTED_PAGES = [
  '/dashboard.html', '/clientes.html', '/membresias.html', '/pagos.html',
  '/planes.html', '/asistencia.html', '/productos.html', '/caja.html',
  '/reports.html', '/users.html', '/landing-admin.html', '/solicitudes.html',
];
app.get(PROTECTED_PAGES, noCache, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', req.path));
});

// Rutas API
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/clientes',     require('./routes/clientes'));
app.use('/api/membresias',   require('./routes/membresias'));
app.use('/api/planes',       require('./routes/planes'));
app.use('/api/pagos',        require('./routes/pagos'));
app.use('/api/asistencia',   require('./routes/asistencia'));
app.use('/api/productos',    require('./routes/productos'));
app.use('/api/ventas',       require('./routes/ventas'));
app.use('/api/caja',         require('./routes/caja'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/reports',      require('./routes/reports'));
app.use('/api/landing',      require('./routes/landing'));
app.use('/api/solicitudes',  require('./routes/solicitudes'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Manejador de errores centralizado ────────────────────────────────────────
// Captura errores lanzados con next(err) o errores no controlados
app.use((err, req, res, _next) => {
  console.error('[ERROR]', req.method, req.path, err);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Error interno del servidor.',
  });
});

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`)))
  .catch(err => { console.error('Error iniciando DB:', err); process.exit(1); });

module.exports = app;
