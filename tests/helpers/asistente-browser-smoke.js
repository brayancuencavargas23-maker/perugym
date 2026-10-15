// Chrome real con API simulada: no envía mensajes ni consulta el proveedor IA.
const http = require('http');
const fs = require('fs');
const path = require('path');
const chromeSmokeResult = require('./chrome-smoke-result');
const root = path.resolve(__dirname, '../../public');
const mock = `<script>
localStorage.setItem('gym_token','test');
window.__spaPageAbort=new AbortController();
window.smokeErrors=[];
window.addEventListener('error',e=>smokeErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>smokeErrors.push(String(e.reason)));
window.serverSeen=new Set();window.readCalls=[];
window.notifs=[{clave:'a'.repeat(64),titulo:'Ana <img src=x> — vence hoy',detalle:'Mensual',prioridad:'alta',tipo:'vencimiento_hoy'},
 {clave:'solicitud:'+'c'.repeat(24),titulo:'Nueva solicitud',detalle:'Mensual',prioridad:'alta',tipo:'nueva_solicitud'}];
notifs.push(...Array.from({length:8},(_,i)=>({clave:(i+1).toString(16).repeat(64),titulo:'Alerta '+i,detalle:'Detalle',tipo:'stock_bajo'})));
window.initialCount=notifs.length;
const snapshot=()=>({total:notifs.length,no_leidas:notifs.filter(n=>!serverSeen.has(n.clave)).length,items:notifs.map(n=>({...n,leida:serverSeen.has(n.clave)}))});
window.fetch=async(url,opts={})=>{
 let data={};
 if(url==='/api/dashboard/notifications')data=snapshot();
 else if(url==='/api/dashboard/notifications/read'){const keys=JSON.parse(opts.body).claves;readCalls.push(keys);keys.forEach(k=>serverSeen.add(k));data=snapshot();}
 else if(url==='/api/dashboard/activity')data=[];
 else if(String(url).startsWith('/api/agente/reporte'))data={respuesta:'Ingresos: S/ 40.00',acciones:[{tipo:'descarga',titulo:'Descargar Excel',path:'/reports/analytics/excel?from=2026-09-01&to=2026-09-28',archivo:'reporte.xlsx'}]};
 else if(String(url).startsWith('/api/agente/recomendaciones'))data={respuesta:'Ana: saldo pendiente de S/ 60.00',acciones:[{tipo:'preparar_mensaje',titulo:'Mensaje para Ana',cliente_id:'cliente1',motivo:'pago'}]};
 else if(String(url).startsWith('/api/agente/clientes'))data={clientes:[{id:'cliente1',nombre:'Ana <img src=x>',dni:'12345678',telefono:'999888777'}]};
 else if(url==='/api/agente/mensaje')data={respuesta:'Mensaje preparado.',acciones:[{tipo:'mensaje',nombre:'Ana <img src=x>',telefono:'51999888777',mensaje:'Hola Ana, saldo S/ 60.00 & gracias.'}]};
 else if(url==='/api/agente/chat')data={respuesta:'Consulta recibida.'};
  return {ok:true,status:200,json:async()=>data,blob:async()=>new Blob(['excel'])};
};
</script>`;
const tests = `<script>
window.addEventListener('load',async()=>{
 const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timeout de interfaz')};
 try{
 if(location.pathname==='/widget'){
   document.getElementById('agent-fab').click();
   if(document.getElementById('agent-fab').getAttribute('aria-expanded')!=='true')throw new Error('No abre asistente');
   document.querySelector('[data-agent-mode="report"]').click();
   document.getElementById('agent-report-form').requestSubmit();
   await wait(()=>document.querySelector('.agent-action-button')?.textContent==='Descargar Excel');
   if(!document.getElementById('agent-messages').textContent.includes('40.00'))throw new Error('Falta reporte');
   document.querySelector('[data-agent-mode="recommend"]').click();
   await wait(()=>[...document.querySelectorAll('.agent-action-button')].some(b=>b.textContent==='Mensaje para Ana'));
   [...document.querySelectorAll('.agent-action-button')].find(b=>b.textContent==='Mensaje para Ana').click();
   await wait(()=>document.querySelector('.agent-action textarea'));
   const field=document.querySelector('.agent-action textarea');
   field.value='Hola & gracias <Ana>';field.dispatchEvent(new Event('input'));
   const link=document.querySelector('.agent-action a');
   if(new URL(link.href).searchParams.get('text')!==field.value)throw new Error('Texto WhatsApp incorrecto');
   if(!link.href.startsWith('https://wa.me/51999888777?'))throw new Error('Destinatario incorrecto');
   if(document.querySelector('.agent-action img'))throw new Error('HTML no escapado');
   field.value='';field.dispatchEvent(new Event('input'));if(link.hasAttribute('href'))throw new Error('Mensaje vacío habilitado');
   document.querySelector('[data-agent-mode="message"]').click();
   document.getElementById('agent-client-search').value='Ana';document.getElementById('agent-find-client').click();
   await wait(()=>document.getElementById('agent-client-select').options.length===2);
   document.getElementById('agent-client-select').value='cliente1';
   document.getElementById('agent-client-search').dispatchEvent(new Event('input'));
   if(document.getElementById('agent-client-select').value)throw new Error('Destinatario obsoleto');
   const rect=document.getElementById('agent-panel').getBoundingClientRect();
   if(rect.left<0||rect.right>innerWidth+1||rect.top<0||rect.bottom>innerHeight+1)throw new Error('Panel fuera del viewport');
   document.getElementById('agent-close').click();
   if(document.activeElement.id!=='agent-fab')throw new Error('Foco no restaurado');
 }else{
   document.getElementById('topbar').innerHTML=_buildTopbarHTML({name:'Admin',role:'admin'});
   attachTopbarListeners();
    _loadNotifBadge();await wait(()=>document.getElementById('topbar-notif-count').textContent===String(initialCount));
   await new Promise(r=>setTimeout(r,100));if(readCalls.length)throw new Error('Lectura antes de abrir');
   openRightPanel();await wait(()=>document.querySelector('[data-notif-key]'));
    await wait(()=>serverSeen.size===initialCount);
   await wait(()=>document.getElementById('topbar-notif-count').style.display==='none');
   if(document.querySelector('#panel-body img'))throw new Error('Alerta no escapada');
    if(!document.querySelector('[data-notif-count]').hidden)throw new Error('El panel conserva el contador de alertas vistas');
    actualizarNotificaciones({total:initialCount,items:notifs.map(n=>({...n,leida:false}))});
   if(document.getElementById('topbar-notif-count').style.display!=='none')throw new Error('Respuesta antigua reactiva badge');
   closeRightPanel();notifs.push({clave:'b'.repeat(64),titulo:'Nueva alerta',detalle:'Stock',tipo:'stock_bajo'});
   _loadNotifBadge();await wait(()=>document.getElementById('topbar-notif-count').style.display!=='none');
    if(serverSeen.size!==initialCount)throw new Error('Novedad marcada sin ver');
    openRightPanel();await wait(()=>serverSeen.size===initialCount+1);
    _loadNotifBadge();await wait(()=>document.getElementById('topbar-notif-count').style.display==='none');
 }
 if(smokeErrors.length)throw new Error(smokeErrors.join('; '));
 parent.document.body.dataset.smoke='PASS';
 }catch(err){parent.document.body.dataset.smoke='FAIL: '+err.message+' | '+smokeErrors.join('; ')+' | '+err.stack;}
});
</script>`;

async function main() {
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error('Chrome no encontrado.');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<html><body style="margin:0"><iframe title="Prueba" src="/${url.searchParams.get('page')}" style="border:0;width:${Number(url.searchParams.get('width'))}px;height:900px"></iframe></body></html>`); return;
    }
    if (['/widget', '/notifications'].includes(url.pathname)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/main.css"><link rel="stylesheet" href="/css/agent-widget.css"><style>*,*::before,*::after{transition:none!important;animation:none!important}</style>${mock}</head><body><div id="topbar"></div><span id="nav-badge-notificaciones"></span><script src="/js/cache.js"></script><script src="/js/utils.js"></script><script src="/js/layout.js"></script>${url.pathname === '/widget' ? '<script src="/js/agent-widget.js"></script>' : ''}${tests}</body></html>`); return;
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let profile;
  try {
    const temp = path.join(require('os').tmpdir(), 'opencode');
    if (!fs.existsSync(temp)) throw new Error('Temporal no disponible.');
    profile = fs.mkdtempSync(path.join(temp, 'asistente-browser-'));
    for (const page of ['widget', 'notifications']) for (const width of [1440, 375]) {
      const caseProfile = fs.mkdtempSync(path.join(profile, 'case-'));
      const result = await chromeSmokeResult(chrome, caseProfile,
        `http://127.0.0.1:${server.address().port}/?page=${page}&width=${width}`);
      if (result !== 'PASS') throw new Error(`${page} ${width}px: ${result}`);
      console.log(`PASS: ${page} ${width}px — flujos, escape HTML y estado visible.`);
    }
  } finally { server.close(); if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} } }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
