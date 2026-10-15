const http = require('http');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const run = promisify(require('child_process').execFile);
const routerPath = path.resolve(__dirname, '../../public/js/router.js');
const checks = `<script>
(async () => {
  const wait = async predicate => {
    for (let i=0; i<100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r,30)); }
    throw new Error('Timeout de recuperación');
  };
  try {
    parent.document.body.dataset.stage = 'inicio';
    // Chrome headless no garantiza frames del iframe con reloj virtual.
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
    const realFetch = window.fetch;
    window.fetch = (...args) => window.failPlanes && String(args[0]).includes('/planes.html')
      ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(...args);
    GymRouter.init('dashboard');
    parent.document.body.dataset.stage = 'cargando dashboard';
    await GymRouter.navigate('dashboard');
    if (!document.getElementById('page-dashboard')) throw new Error('No carga inicio');
    window.failPlanes = true;
    parent.document.body.dataset.stage = 'simulando caída';
    await GymRouter.navigate('planes');
    if (!document.querySelector('#spa-content [role=alert]')) throw new Error('No conserva error dentro del panel');
    if (!document.getElementById('sidebar')) throw new Error('Se perdió el shell');
    const entries = history.length;
    window.failPlanes = false;
    document.querySelector('#spa-content button').click();
    parent.document.body.dataset.stage = 'reintentando planes';
    await wait(() => document.getElementById('page-planes') && window.initializedPage === 'planes');
    if (history.length !== entries) throw new Error('Reintentar duplica historial');
    parent.document.body.dataset.stage = 'fallo de script';
    await GymRouter.navigate('reports');
    if (!document.querySelector('#spa-content [role=alert]')) throw new Error('No detecta recurso fallido');
    if (document.querySelector('script[src$="router-fixture.js"]')) throw new Error('Conserva script fallido');
    document.querySelector('#spa-content button').click();
    parent.document.body.dataset.stage = 'reintentando script';
    await wait(() => window.initializedPage === 'reports' && window.fixtureLoaded === 1);
    await GymRouter.navigate('dashboard');
    parent.document.body.dataset.stage = 'restaurando caché';
    await GymRouter.navigate('reports');
    if (window.fixtureLoaded !== 1) throw new Error('Duplica el script al restaurar caché');
    await GymRouter.navigate('clientes');
    if (!document.querySelector('#spa-content [role=alert]')) throw new Error('Acepta respuesta sin módulo');
    await GymRouter.navigate('planes');
    if (!document.getElementById('page-planes')) throw new Error('No recupera navegación después del error');
    parent.document.body.dataset.smoke='PASS';
  } catch (err) { parent.document.body.dataset.smoke='FAIL: '+err.message; }
})();
</script>`;

async function main() {
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error('Chrome no encontrado. Define CHROME_PATH.');
  let scriptRequests = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/') {
      res.end('<html><body><iframe title="Prueba de navegación" src="/shell"></iframe></body></html>');
    } else if (req.url === '/shell') {
      res.end(`<html><body><div id="sidebar"></div><div class="topbar"><h1>Panel</h1></div>
        <div class="main-content"><div id="spa-content"></div></div>
        <script src="/js/router.js"></script>${checks}</body></html>`);
    } else if (req.url === '/js/router.js') {
      res.setHeader('Content-Type', 'application/javascript');
      fs.createReadStream(routerPath).pipe(res);
    } else if (req.url === '/js/router-fixture.js') {
      res.setHeader('Content-Type', 'application/javascript');
      if (++scriptRequests === 1) { res.writeHead(503); res.end(''); }
      else res.end('window.fixtureLoaded=(window.fixtureLoaded||0)+1;');
    } else {
      const page = req.url.replace('/', '').replace('.html', '');
      if (page === 'clientes') { res.end('<html><body>Respuesta incompleta</body></html>'); return; }
      res.end(`<html><body><div class="page-content"><p id="page-${page}">${page}</p></div>
        ${page === 'reports' ? '<script src="/js/router-fixture.js"></script>' : ''}
        <script>window.initializedPage='${page}';</script></body></html>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let profile;
  try {
    const temp = path.join(require('os').tmpdir(), 'opencode');
    if (!fs.existsSync(temp)) throw new Error('Directorio temporal no disponible');
    profile = fs.mkdtempSync(path.join(temp, 'router-recovery-'));
    const { stdout } = await run(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--virtual-time-budget=12000', '--dump-dom',
      `http://127.0.0.1:${server.address().port}/`], { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
    const result = stdout.match(/data-smoke="([^"]+)"/)?.[1];
    if (result !== 'PASS') throw new Error(result || `Sin resultado: ${stdout.match(/data-stage="([^"]+)"/)?.[1] || 'sin inicio'}`);
    console.log('PASS: router — caída de conexión, reintento sin recarga, script fallido, caché y respuesta incompleta.');
  } finally {
    server.close();
    if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
