// Frontend, API y MongoDB temporal reales; no importa server.js ni datos locales.
process.env.JWT_SECRET = 'catalogo-browser-temporary-secret';
process.env.DISABLE_TRANSACTIONS = 'false';
const express = require('express');
const fileUpload = require('express-fileupload');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const chromeSmokeResult = require('./chrome-smoke-result');
const checks = require('./catalogo-browser-checks');
const Producto = require('../../models/Producto');
const Usuario = require('../../models/Usuario');
const root = path.resolve(__dirname, '../../public');

async function main() {
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error('Chrome no encontrado.');
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let server, profile, session;
  try {
    await mongoose.connect(db.getUri());
    const app = express();
    app.use(express.json());
    app.use(fileUpload());
    for (const module of ['auth', 'productos', 'compras', 'proveedores', 'inventario', 'dashboard', 'asistencia', 'solicitudes']) {
      app.use('/api/' + module, require('../../routes/' + module));
    }
    app.get('/', (req, res) => res.send(`<html><body style="margin:0"><iframe title="Prueba" src="/app.html?page=productos&theme=${req.query.theme}" style="border:0;width:${Number(req.query.width)}px;height:1100px"></iframe></body></html>`));
    app.get('/app.html', (req, res) => {
      const bootstrap = `<script>localStorage.setItem('gym_token',${JSON.stringify(session.token)});localStorage.setItem('gym_user',${JSON.stringify(JSON.stringify(session.user))});localStorage.setItem('gym_theme',${JSON.stringify(req.query.theme || 'light')});</script>`;
      const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
      res.send(html.replace('</head>', bootstrap + '</head>').replace('</body>', checks + '</body>'));
    });
    app.use(express.static(root));
    server = await new Promise(resolve => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
    const temp = path.join(require('os').tmpdir(), 'opencode');
    if (!fs.existsSync(temp)) throw new Error('Temporal no disponible.');
    profile = fs.mkdtempSync(path.join(temp, 'catalogo-real-'));
    for (const width of [1440, 375]) for (const theme of ['light', 'dark']) {
      for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
      const admin = await Usuario.create({ usuario: 'AdminPrueba', email: 'admin@prueba.pe', password: 'x', rol: 'admin' });
      session = { user: { id: String(admin._id), name: admin.usuario, role: 'admin', permisos: [] } };
      session.token = jwt.sign(session.user, process.env.JWT_SECRET, { expiresIn: '1h' });
      await Producto.insertMany([
        ...Array.from({ length: 500 }, (_, i) => ({ nombre: 'A' + String(i).padStart(3, '0'), categoria: 'Bebidas', precio_venta: 2, stock: 0 })),
        { nombre: 'Zultimo', categoria: 'Bebidas', precio_venta: 10, stock: 10, costo: 4 },
      ]);
      const result = await chromeSmokeResult(chrome, fs.mkdtempSync(path.join(profile, 'case-')),
        `http://127.0.0.1:${server.address().port}/?width=${width}&theme=${theme}`);
      if (result !== 'PASS') throw new Error(`${width}px ${theme}: ${result}`);
      console.log(`PASS: catálogo real ${width}px ${theme}: 502 productos, proveedor, compra, stock/costo, KPI, historial, lotes y navegación.`);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await db.stop();
    if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
