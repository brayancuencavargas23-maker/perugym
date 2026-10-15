// Sirve HTML estático como Netlify; scripts reales y respuestas API simuladas.
const http = require('http');
const fs = require('fs');
const path = require('path');
const chromeSmokeResult = require('./chrome-smoke-result');
const root = path.resolve(__dirname, '../../public');
const fixture = `<script>
window.smokeErrors=[];
window.addEventListener('error',e=>smokeErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>smokeErrors.push(String(e.reason)));
const variant=new URL(location.href).searchParams.get('variant')||sessionStorage.getItem('smoke-variant')||'admin';
sessionStorage.setItem('smoke-variant',variant);
localStorage.setItem('gym_token','test.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))+'.test');
localStorage.setItem('gym_user',JSON.stringify({id:'u1',name:'Ana',role:variant,permisos:['dashboard','asistencia','compras']}));
document.documentElement.dataset.theme=new URL(location.href).searchParams.get('theme')||'light';
window.Chart=class {destroy(){} update(){} static getChart(){return null;}};
const realFetch=window.fetch;
window.fetch=async(url,opts={})=>{
 const p=new URL(url,location.href);
 if(!p.pathname.startsWith('/api/'))return realFetch(url,opts);
 let data={};
 if(p.pathname==='/api/dashboard')data={stats:{clientesActivos:1,clientesRegistrados:3,ventasTurno:{total:0},asistenciaHoy:0,pagosPendientes:0},membresiasVencenPronto:[],alertas:{vencenManana:[]}};
 else if(p.pathname==='/api/dashboard/notifications')data={items:[],total:0,no_leidas:0};
 else if(p.pathname==='/api/dashboard/activity')data=[];
 else if(p.pathname==='/api/dashboard/charts')data={asistencia:{labels:[],data:[]}};
 else if(p.pathname==='/api/dashboard/ingresos-hoy')data={total_hoy:0,tendencia:0,desglose:[]};
 else if(p.pathname==='/api/solicitudes/stats')data={pendiente:0,contactado:0,pendiente_no_leidas:0};
 else if(p.pathname==='/api/auth/users')data=[{id:'u2',name:'Luis',email:'l@test.pe',role:'recepcionista',active:true,permisos:[]}];
 else if(p.pathname.endsWith('/permisos')){window.savedPermisos=JSON.parse(opts.body);data={message:'OK'};}
 else if(p.pathname==='/api/compras/resumen')data={valorizacion:0,compras_mes:0,proveedores_activos:0};
 else if(p.pathname==='/api/asistencia/aforo')data={en_el_gym:0};
 else if(p.pathname==='/api/planes')data=[];
 else data={data:[],total:0,pages:0,stats:{total_hoy:0,en_curso:0,promedio_min:null}};
 return {ok:true,status:200,json:async()=>data};
};
</script>`;
const checks = `<script>
(async()=>{try{
 const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timeout: '+smokeErrors.join('; '));};
 if(sessionStorage.getItem('smoke-compra-direct')){
   await wait(()=>document.getElementById('compras-table'));
   if(document.getElementById('compras-section').classList.contains('hidden'))throw new Error('Compras directo pierde permisos');
   sessionStorage.removeItem('smoke-compra-direct');
 }else if(sessionStorage.getItem('smoke-fallback')){
   await wait(()=>document.activeElement.id==='checkin-search');
   if(location.pathname!=='/asistencia.html')throw new Error('Fallback vuelve a dashboard');
   sessionStorage.removeItem('smoke-fallback');
 }else{
   await wait(()=>document.getElementById('stat-members')?.textContent==='1');
   if(document.getElementById('stat-members-total').textContent!=='De 3 clientes registrados')throw new Error('Falta total registrado');
   const shell=document.getElementById('sidebar');
   document.getElementById('topbar-checkin-btn').click();
   await wait(()=>document.activeElement.id==='checkin-search');
   if(location.pathname!=='/asistencia.html'||shell!==document.getElementById('sidebar'))throw new Error('Check-in recarga o navega mal');
   if(variant==='admin'){
     await GymRouter.navigate('users');
     await wait(()=>document.getElementById('users-table').textContent.includes('Luis'));
     openPermisos('u2','Luis',[]);
     const compra=document.querySelector('#permisos-checks input[value="compras"]');
     if(!compra)throw new Error('Falta permiso Compras');
     compra.checked=true;await savePermisos();
     if(!savedPermisos.permisos.includes('compras'))throw new Error('No guarda permiso');
     await GymRouter.navigate('dashboard');
     sessionStorage.setItem('smoke-fallback','1');
     window.GymRouter=undefined;
     document.getElementById('topbar-checkin-btn').click();return;
   }
   if(!document.querySelector('#sidebar [data-page="compras"]'))throw new Error('Compras no visible con permiso');
   await GymRouter.navigate('compras');
   await wait(()=>document.getElementById('compras-table'));
   if(document.getElementById('compras-section').classList.contains('hidden'))throw new Error('Compras bloqueado con permiso');
   sessionStorage.setItem('smoke-compra-direct','1');location.href='/compras.html';return;
 }
 if(smokeErrors.length)throw new Error(smokeErrors.join('; '));
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
      res.end(`<html><body style="margin:0"><iframe title="Prueba" src="/app.html?variant=${url.searchParams.get('variant')}&theme=${url.searchParams.get('theme')}" style="border:0;width:${Number(url.searchParams.get('width'))}px;height:1000px"></iframe></body></html>`);
      return;
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    if (url.pathname === '/app.html') {
      res.end(fs.readFileSync(file, 'utf8').replace('</head>', fixture + '</head>').replace('</body>', checks + '</body>'));
    } else {
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'application/javascript');
      fs.createReadStream(file).pipe(res);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let profile;
  try {
    const temp = path.join(require('os').tmpdir(), 'opencode');
    if (!fs.existsSync(temp)) throw new Error('Temporal no disponible.');
    profile = fs.mkdtempSync(path.join(temp, 'dashboard-production-'));
    for (const variant of ['admin', 'recepcionista']) for (const width of [1440, 375]) for (const theme of ['light', 'dark']) {
      const caseProfile = fs.mkdtempSync(path.join(profile, 'case-'));
      const result = await chromeSmokeResult(chrome, caseProfile,
        `http://127.0.0.1:${server.address().port}/?variant=${variant}&width=${width}&theme=${theme}`);
      if (result !== 'PASS') throw new Error(`${variant} ${width}px ${theme}: ${result}`);
      console.log(`PASS: dashboard estático ${variant} ${width}px ${theme} — tarjeta, check-in y Compras/permisos.`);
    }
  } finally {
    server.close();
    if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
