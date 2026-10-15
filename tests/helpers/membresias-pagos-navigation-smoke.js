// Router y módulos reales con API simulada; no usa los datos del gimnasio.
const http = require('http');
const fs = require('fs');
const path = require('path');
const run = require('util').promisify(require('child_process').execFile);
const root = path.resolve(__dirname, '../../public');
const mock = `<script>
window.__SPA_SHELL__=true;
window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);
localStorage.setItem('gym_user',JSON.stringify({role:'admin'}));
window.errors=[];
window.addEventListener('error',e=>errors.push(e.message));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const mem={id:'mem1',_id:'mem1',cliente_id:{_id:'cliente1'},cliente_nombre:'Ana',
 plan_nombre:'Mensual',precio:100,monto_total:100,total_pagado:100,saldo_total:0,
 estado:'activo',fecha_inicio:'2026-10-01',fecha_fin:'2026-11-01'};
const api={get:async p=>{
 if(p==='/planes')return [{_id:'plan1',nombre:'Mensual',precio:100,duracion_dias:30,activo:true}];
 if(p==='/caja/estado')return {id:'caja1'};
 if(p.startsWith('/clientes'))return {data:[{_id:'cliente1',nombre:'Ana'}]};
 if(p.startsWith('/pagos?'))return {data:['mem1','mem2'].map((id,i)=>({id:'p'+i,
   membresia_id:{_id:id},cliente_nombre:i?'Luis':'Ana',plan_nombre:'Mensual',
   monto:100,total_esperado:100,estado:'pagado',fecha_pago:'2026-10-14'}))};
 return {data:[structuredClone(mem)],total:1,pages:1};
}};
</script>`;
const checks = `<script>
(async()=>{try{
 const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timeout: '+errors.join('; '));};
 const shell=document.getElementById('sidebar');
 const initialTime=performance.timeOrigin;
 GymRouter.init('membresias');
 await GymRouter.navigate('membresias',false);
 await wait(()=>document.querySelector('[title="Ver pagos en gestión de pagos"]'));
 const historyButton=document.querySelector('[aria-label="Ver historial de periodos"]');
 if(!historyButton?.querySelector('svg'))throw new Error('Historial sin icono');
 if(!historyButton.querySelector('svg').getAttribute('aria-hidden'))throw new Error('Icono no decorativo');
 document.querySelector('[title="Ver pagos en gestión de pagos"]').click();
 await wait(()=>document.getElementById('pagos-table')?.textContent.includes('Ana'));
 if(location.pathname!=='/pagos.html')throw new Error('No llega a pagos');
 if(document.getElementById('filter-membresia-id').value!=='mem1')throw new Error('Pierde filtro');
 if(document.getElementById('pagos-table').textContent.includes('Luis'))throw new Error('Muestra otra membresía');
 if(sessionStorage.getItem('_spa_param_membresia_id'))throw new Error('No consume parámetro');
 await GymRouter.navigate('membresias');
 await wait(()=>document.querySelector('[title="Ver pagos en gestión de pagos"]'));
 document.querySelector('[title="Ver pagos en gestión de pagos"]').click();
 await wait(()=>document.getElementById('filter-membresia-id')?.value==='mem1');
 if(document.getElementById('sidebar')!==shell||performance.timeOrigin!==initialTime)throw new Error('Recarga el sistema');
 if(errors.length)throw new Error(errors.join('; '));
 parent.document.body.dataset.smoke='PASS';
}catch(e){parent.document.body.dataset.smoke='FAIL: '+e.message;}})();
</script>`;

async function main() {
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error('Chrome no encontrado.');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/') {
      res.end(`<html><body><iframe title="Prueba" src="/shell?theme=${url.searchParams.get('theme')}" style="width:${Number(url.searchParams.get('width'))}px;height:1000px;border:0"></iframe></body></html>`);
      return;
    }
    if (url.pathname === '/shell') {
      res.end(`<html data-theme="${url.searchParams.get('theme')}"><head><link rel="stylesheet" href="/css/main.css">${mock}</head><body>
        <div id="sidebar"></div><div class="topbar"><h1>Panel</h1></div><div class="main-content"><div id="spa-content"></div></div>
        <script src="/js/cache.js"></script><script src="/js/utils.js"></script><script src="/js/icons.js"></script>
        <script src="/js/router.js"></script>${checks}</body></html>`);
      return;
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    if (file.endsWith('.html')) {
      res.end(fs.readFileSync(file, 'utf8').replace(/initLayout\('(membresias|pagos)', '[^']+'\);/, ''));
    } else {
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript');
      fs.createReadStream(file).pipe(res);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let profile;
  try {
    const temp = path.join(require('os').tmpdir(), 'opencode');
    if (!fs.existsSync(temp)) throw new Error('Temporal no disponible.');
    profile = fs.mkdtempSync(path.join(temp, 'membresias-navigation-'));
    for (const width of [1440, 375]) for (const theme of ['light', 'dark']) {
      const { stdout } = await run(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`, '--virtual-time-budget=12000', '--dump-dom',
        `http://127.0.0.1:${server.address().port}/?width=${width}&theme=${theme}`], { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
      const result = stdout.match(/data-smoke="([^"]+)"/)?.[1];
      if (result !== 'PASS') throw new Error(`${width}px ${theme}: ${result || 'sin resultado'}`);
      console.log(`PASS: membresías → pagos ${width}px ${theme}, filtro, icono y navegación desde caché sin recarga.`);
    }
  } finally {
    server.close();
    if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
