// API simulada; formularios y scripts reales en Chrome headless.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const run = promisify(require('child_process').execFile);
const publicDir = path.resolve(__dirname, '../../public');
const mock = `<script>
window.__SPA_SHELL__=true; window.__spaPageAbort=new AbortController();
localStorage.setItem('gym_user',JSON.stringify({role:'admin'}));
window.fixturePlan={_id:'plan1',nombre:'Interdiario',precio:90,duracion_dias:30,limite_semanal:3,activo:true};
window.blocked=false;
const api={
 get:async(p)=>p==='/planes'?[fixturePlan]:p.startsWith('/clientes')?{data:[{_id:'cliente1',nombre:'Ana'}]}:{data:[],stats:{total_hoy:0,en_curso:0,promedio_min:null},total:0,pages:0},
 request:async()=>({plan_nombre:'Interdiario',fecha_fin:'2026-10-28T05:00:00Z',limite_semanal:3,visitas_semana:blocked?3:2,disponibles:blocked?0:1,permitido:!blocked,motivo:blocked?'Límite semanal alcanzado.':''}),
 put:async(p,b)=>{window.savedBody=b;return {...fixturePlan,...b}},
 post:async()=>{throw new Error('Límite semanal alcanzado.');}
};
window.addEventListener('error',e=>{window.smokeError=e.message});
window.addEventListener('unhandledrejection',e=>{window.smokeError=String(e.reason)});
</script>`;
const checks = `<script>
(async()=>{try{
 const wait=async(fn)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timeout de interfaz')};
 if(document.getElementById('plans-grid')){
   await wait(()=>document.getElementById('plans-grid').textContent.includes('3 visitas por semana'));
   editPlan('plan1');
   if(document.getElementById('p-weekly').value!=='3')throw new Error('No carga límite');
   if(document.getElementById('p-apply-policy').checked)throw new Error('Aplicación automática inesperada');
   document.getElementById('p-weekly').value='4';
   document.getElementById('p-apply-policy').checked=true;
   await savePlan();
   if(savedBody.limite_semanal!==4||!savedBody.aplicar_membresias)throw new Error('Configuración no enviada');
   document.getElementById('btn-new').click();
   if(document.getElementById('p-weekly').value!==''||document.getElementById('p-apply-policy').checked)throw new Error('Nuevo plan conserva datos anteriores');
 }else{
   await wait(()=>window._clientesCheckin?.length);
   selectCheckinCliente('cliente1','Ana');
   await wait(()=>document.getElementById('checkin-policy').textContent.includes('2/3'));
   if(!document.getElementById('checkin-policy').textContent.includes('1 disponibles'))throw new Error('Falta saldo');
   window.blocked=true; selectCheckinCliente('cliente1','Ana');
   await wait(()=>document.getElementById('checkin-policy').textContent.includes('Límite semanal'));
   await doCheckin();
   if(document.getElementById('checkin-cliente').value!=='cliente1')throw new Error('Error borra cliente');
   const input=document.getElementById('checkin-search');input.value='Otro';input.dispatchEvent(new Event('input'));
   if(!document.getElementById('checkin-policy').textContent.includes('Selecciona'))throw new Error('Saldo obsoleto');
 }
 if(window.smokeError)throw new Error(window.smokeError);
 parent.document.body.dataset.smoke='PASS';
}catch(e){parent.document.body.dataset.smoke='FAIL: '+e.message}})();
</script>`;

async function main() {
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error('Chrome no encontrado. Define CHROME_PATH.');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/') {
      res.end(`<html><body><iframe title="Prueba" src="/${url.searchParams.get('page')}.html" style="width:${Number(url.searchParams.get('width'))}px;height:1000px;border:0"></iframe></body></html>`);
      return;
    }
    const file = path.resolve(publicDir, '.' + url.pathname);
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    if (['/planes.html', '/asistencia.html'].includes(url.pathname)) {
      let html = fs.readFileSync(file, 'utf8').replace('<head>', '<head>' + mock)
        .replace('<script src="/js/api.js"></script>', '')
        .replace(/initLayout\('(planes|asistencia)', '[^']+'\);/, '');
      res.end(html.replace('</body>', checks + '</body>'));
    } else {
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript');
      fs.createReadStream(file).pipe(res);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let profile;
  try {
    const temp = path.join(require('os').tmpdir(), 'opencode');
    if (!fs.existsSync(temp)) throw new Error('Directorio temporal no disponible');
    profile = fs.mkdtempSync(path.join(temp, 'asistencia-browser-'));
    for (const page of ['planes', 'asistencia']) {
      for (const width of [1440, 375]) {
        const { stdout } = await run(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
          `--user-data-dir=${profile}`, '--window-size=1600,1100', '--virtual-time-budget=10000', '--dump-dom',
          `http://127.0.0.1:${server.address().port}/?page=${page}&width=${width}`], { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
        const result = stdout.match(/data-smoke="([^"]+)"/)?.[1];
        if (result !== 'PASS') throw new Error(`${page} ${width}px: ${result || 'sin resultado'}`);
        console.log(`PASS: ${page} ${width}px — configuración y consulta de cupos.`);
      }
    }
  } finally {
    server.close();
    if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
