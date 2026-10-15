// Ejecutar: node tests/helpers/reports-browser-smoke.js
// Prueba de interfaz aislada: API simulada, HTML/CSS/JS reales y Chrome headless.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const publicDir = path.resolve(__dirname, '../../public');
const fixture = {
  periodo: { from:'2026-09-01',to:'2026-09-15',previousFrom:'2026-08-17',previousTo:'2026-08-31',days:15 }, actualizado:'2026-09-26T18:00:00Z',
  stats: { ingresos:85,anterior:40,variacion:112.5,activos:1,nuevos:1,renovacion:null,elegibles:0,renovados:0,saldo:50,deudores:1,inactivos:0,visitas:1,visitantes:1,egresos:8 },
  daily:[{fecha:'2026-09-01',actual:85,anteriorFecha:'2026-08-17',anterior:40,altas:1,renovaciones:0}],
  sources:{membresias:50,productos:20,rutinas:10,otros:5}, heatmap:Array.from({length:7},()=>Array(24).fill(0)), plans:[{nombre:'Mensual',cantidad:1}],
  debts:[{nombre:'Ana <img src=x>',plan:'Mensual',acordado:100,pagado:50,saldo:50}], renewals:[],products:[],stockAlerts:[],incomeAlert:false,
  recommendations:[{clave:'saldo:123456789012345678901234',nombre:'Ana <img src=x>',tipo:'saldo',motivo:'Saldo de S/ 50',accion:'Gestionar abono',telefono:'999999999',seguimiento:{estado:'pendiente'}}],
  activeClients:[{nombre:'Ana',plan:'Mensual',inicio:'2026-09-01',fin:'2026-10-01'}],newClients:[{nombre:'Ana',fecha:'2026-09-01'}],inactiveClients:[]
};
const mock = `<script>window.__SPA_SHELL__=true;window.__spaPageAbort=new AbortController();const api={get:async()=>(${JSON.stringify(fixture)}),put:async(_,body)=>({...body,responsable:'Prueba',actualizado:new Date().toISOString()}),download:async()=>{}};</script>`;
const checks = `<script>
window.addEventListener('error',e=>{document.body.dataset.error=e.message;});
async function check(){
try {
 const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout de interfaz');};
 await wait(()=>!document.getElementById('rep-results').hidden);
 if(document.querySelectorAll('.rep-kpi').length!==6)throw new Error('Faltan indicadores');
 document.querySelector('[data-view="debts"]').click();
 if(document.querySelector('#rep-body img'))throw new Error('Contenido sin escapar');
 const search=document.getElementById('rep-search');search.value='inexistente';search.dispatchEvent(new Event('input'));
 if(!document.getElementById('rep-body').textContent.includes('Sin resultados'))throw new Error('Búsqueda incorrecta');
 document.querySelector('[data-view="recommendations"]').click();
 const select=document.querySelector('[data-track]');select.value='contactado';select.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>document.getElementById('rep-body').textContent.includes('Prueba'));
 if(!document.querySelector('a[href^="https://wa.me/51999999999"]'))throw new Error('Contacto incorrecto');
 if(document.documentElement.scrollWidth>innerWidth+2)throw new Error('Desbordamiento horizontal '+document.documentElement.scrollWidth+'/'+innerWidth);
 if(document.body.dataset.error)throw new Error(document.body.dataset.error);
 window.__spaPageAbort.abort();parent.document.body.dataset.viewport=innerWidth;parent.document.body.dataset.smoke='PASS';
}catch(e){parent.document.body.dataset.smoke='FAIL: '+e.message;}}
check();</script>`;

async function main() {
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error('Define CHROME_PATH para ejecutar la comprobación de navegador.');
  const server = http.createServer((req,res)=>{
    const url = new URL(req.url,'http://localhost');
    if(url.pathname==='/' && url.searchParams.has('width')) {
      const width=Number(url.searchParams.get('width'));
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<html><body style="margin:0"><iframe title="Reportes" src="/report" style="border:0;width:${width}px;height:1000px"></iframe></body></html>`);return;
    }
    if(url.pathname==='/report') {
      let html=fs.readFileSync(path.join(publicDir,'reports.html'),'utf8');
      html=html.replace('<head>','<head>'+mock).replace('<script src="/js/api.js"></script>','').replace("initLayout('reports', 'Reportes y análisis');",'');
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html.replace('</body>',checks+'</body>'));return;
    }
    const filename=path.resolve(publicDir,'.'+url.pathname);
    if(!filename.startsWith(publicDir+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'application/javascript':'application/octet-stream');fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const tempRoot = path.join(require('os').tmpdir(), 'opencode');
  if(!fs.existsSync(tempRoot))throw new Error('Directorio temporal no disponible');
  const profile=fs.mkdtempSync(path.join(tempRoot,'reports-browser-'));
  try {
    for(const width of [1440,375]) {
      const {stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${Math.max(width,600)},1000`,'--virtual-time-budget=12000','--dump-dom',`http://127.0.0.1:${server.address().port}/?width=${width}`],{timeout:60000,maxBuffer:5*1024*1024});
      const result=stdout.match(/data-smoke="([^"]+)"/);
      if(result?.[1]!=='PASS')throw new Error(`Navegador ${width}px: ${result?.[1]||'sin resultado'}`);
      if(!stdout.includes(`data-viewport="${width}"`))throw new Error('Viewport diferente del solicitado.');
      console.log(`PASS: interfaz ${width}px — indicadores, búsqueda, escape HTML, contacto, seguimiento y ancho.`);
    }
  } finally { server.close(); try {fs.rmSync(profile,{recursive:true,force:true});}catch{} }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
