require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fileUpload = require('express-fileupload');
const path = require('path');
const { connectDB } = require('./config/database');

const app = express();

// ── Proxy inverso (nginx, Render, Cloudflare, etc.) ──────────────────────────
// Sin esto, req.ip = IP del proxy y TODOS los clientes comparten el mismo
// contador del rate-limit de login (una sola persona podría bloquear a toda la
// oficina, o el límite no serviría de nada). TRUST_PROXY = nº de saltos.
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY && TRUST_PROXY !== '0' && TRUST_PROXY !== 'false') {
  app.set('trust proxy', TRUST_PROXY === 'true' ? 1 : Number(TRUST_PROXY));
}

// ── Seguridad: headers HTTP ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],                // onclick/onchange/etc. en atributos HTML
      styleSrc:      ["'self'", "'unsafe-inline'"],
      imgSrc:        ["'self'", "data:", "https://res.cloudinary.com", "blob:"],
      connectSrc:    ["'self'", "https://cdn.jsdelivr.net"],
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

// ── Rate limiting de login ───────────────────────────────────────────────────
// (Va DESPUÉS de los body parsers: el limitidor por usuario necesita leer
//  req.body.username. Ver más abajo.)

// ── Body parsers y archivos ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } }));

// ── Rate limiting de login ───────────────────────────────────────────────────
// Dos límites independientes, ambos con `skipSuccessfulRequests` para que los
// inicios de sesión EXITOSOS no consuman cupo (antes, 10 logins válidos en
// 15 minutos agotaban el límite de la IP aunque no hubiera ningún error):
//   · por IP       → acota ataques que rotan de cuenta desde una conexión
//   · por usuario  → evita fuerza bruta contra una cuenta concreta sin castigar
//                    a toda la oficina que comparte la misma IP pública (NAT)
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

const loginIpLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos de inicio de sesión desde esta conexión. Intenta de nuevo en 15 minutos.' },
});

const loginUserLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    return user ? `user:${user}` : `ip:${req.ip}`;
  },
  message: { error: 'Demasiados intentos fallidos para esta cuenta. Intenta de nuevo en 15 minutos.' },
});

app.use('/api/auth/login', loginIpLimiter, loginUserLimiter);

const { noCache } = require('./middleware/auth');

// ── SPA Shell: redirigir páginas del panel al shell app.html ─────────────────
// Cuando el navegador accede directamente a /clientes.html, /pagos.html, etc.
// (sin el header X-SPA-Request), servimos el shell app.html que carga el
// sidebar una sola vez y luego inyecta el contenido de la página solicitada.
// Las peticiones con X-SPA-Request (del router.js) reciben el HTML original
// para que el router pueda extraer solo el contenido relevante.
const PANEL_PAGES = [
  '/dashboard.html', '/clientes.html', '/membresias.html', '/pagos.html',
  '/planes.html', '/asistencia.html', '/productos.html', '/caja.html',
  '/reports.html', '/users.html', '/landing-admin.html', '/solicitudes.html',
  '/compras.html',
];

app.get(PANEL_PAGES, noCache, (req, res) => {
  // Si es una petición del router SPA, servir el HTML original (para parsear)
  if (req.headers['x-spa-request'] === '1') {
    return res.sendFile(path.join(__dirname, 'public', req.path));
  }
  // Si es navegación directa del browser, servir el shell SPA
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Shell SPA con no-cache
app.get('/app.html', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Archivos estáticos (CSS, JS, imágenes) — después de las rutas del panel
app.use(express.static(path.join(__dirname, 'public')));

// Rutas API
app.use('/api/health',       require('./routes/health'));
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/clientes',     require('./routes/clientes'));
app.use('/api/membresias',   require('./routes/membresias'));
app.use('/api/planes',       require('./routes/planes'));
app.use('/api/pagos',        require('./routes/pagos'));
app.use('/api/asistencia',   require('./routes/asistencia'));
  app.use('/api/productos',    require('./routes/productos'));
  app.use('/api/inventario',   require('./routes/inventario'));
  app.use('/api/proveedores',  require('./routes/proveedores'));
  app.use('/api/compras',      require('./routes/compras'));
  app.use('/api/ventas',       require('./routes/ventas'));
app.use('/api/caja',         require('./routes/caja'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/reports',      require('./routes/reports'));
app.use('/api/landing',      require('./routes/landing'));
app.use('/api/solicitudes',  require('./routes/solicitudes'));
app.use('/api/agente',       require('./routes/agente'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Manejador de errores centralizado ────────────────────────────────────────
// Captura errores lanzados con next(err) o errores no controlados
const { errorHandler } = require('./middleware/errorHandler');
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

connectDB()
  .then(async () => {
    if (process.env.DB_MODE !== 'json') {
      const bcrypt = require('bcryptjs');
      const Usuario = require('./models/Usuario');
      const Plan = require('./models/Plan');

      const existing = await Usuario.findOne({ email: 'admin@gym.com' });
      if (!existing) {
        const hash = await bcrypt.hash('admin123', 10);
        await Usuario.create({
          usuario: 'admin',
          email: 'admin@gym.com',
          password: hash,
          rol: 'admin',
        });
      }
      const count = await Plan.countDocuments();
      if (count === 0) {
        await Plan.insertMany([
          { nombre: 'Básico', precio: 99, duracion_dias: 30, descripcion: 'Ideal para empezar', caracteristicas: ['Acceso a sala de musculación', 'Clases grupales básicas', '1 evaluación física mensual'], mostrar_landing: true, destacado: false },
          { nombre: 'Pro', precio: 149, duracion_dias: 30, descripcion: 'Para resultados reales', caracteristicas: ['Acceso ilimitado a todas las áreas', 'Clases grupales ilimitadas', 'Evaluaciones físicas mensuales'], mostrar_landing: true, destacado: true },
          { nombre: 'Premium', precio: 199, duracion_dias: 30, descripcion: 'Máximo rendimiento', caracteristicas: ['Todo en plan PRO', 'Nutricionista incluido', 'Acceso a zonas exclusivas'], mostrar_landing: true, destacado: false },
        ]);
      }
    }
    app.listen(PORT, () => {});
  })
  .catch(err => { console.error('Error iniciando DB:', err); process.exit(1); });

module.exports = app;
