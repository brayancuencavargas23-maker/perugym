// Formularios y scripts reales, API simulada, sin conexión a datos del gimnasio.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const run = promisify(require('child_process').execFile);
const publicDir = path.resolve(__dirname, '../../public');
const mock = `<script>
window.__SPA_SHELL__=true;window.__spaPageAbort=new AbortController();
document.documentElement.dataset.theme=new URL(location.href).searchParams.get('theme')||'light';
localStorage.setItem('gym_user',JSON.stringify({role:'admin'}));
window.fixturePlans = [
  {_id:'plan1', nombre:'Mensual', precio:100, duracion_dias:30, activo:true},
  {_id:'plan2', nombre:'Trimestral', precio:270, duracion_dias:90, activo:true}
];
window.fixtureMem = {
  id:'mem1', _id:'mem1', cliente_id:{_id:'cliente1'}, cliente_nombre:'Ana',
  plan_nombre:'Mensual', plan_actual_id:'plan1', precio:80, precio_original:100,
  total_pagado:80, saldo_total:0, version:0, estado:'vencido',
  fecha_inicio:'2026-01-01T05:00:00Z', fecha_fin:'2026-02-01T05:00:00Z'
};
window.fixturePagos = [80,50,0].map((monto,i) => ({
  id:'p'+i, membresia_id:{_id:'mem1', monto_total:180}, periodo_id:'per'+i,
  cliente_nombre:'Ana', plan_nombre:['Mensual','Otro','Gratis'][i],
  total_esperado:[80,100,0][i], monto, estado:'pagado', fecha_pago:'2026-10-11',
  periodo_inicio:'2026-10-01', periodo_fin:'2026-10-31', metodo_pago:'efectivo', es_abono:i===1
}));
const api = {
  get: async p => {
    if(p==='/planes') return fixturePlans;
    if(p==='/caja/estado') return {id:'caja1'};
    if(p.includes('/detalle')) return structuredClone(fixtureMem);
    if(p.startsWith('/clientes')) return {data:[{_id:'cliente1', nombre:'Ana'}]};
    if(p.startsWith('/pagos?')) return {data:structuredClone(fixturePagos)};
    if(p.includes('/estado-pago')) return {periodo_id:'per1', total_plan:100, total_pagado:50, pendiente:50, completado:false};
    return {data:[structuredClone(fixtureMem)], total:1, pages:1};
  },
  post: async (p,b) => {
    if(p==='/pagos/abono') {
      window.savedAbono = b;
      fixturePagos.push({...fixturePagos[1], id:'abono', monto:b.monto});
      return {pago:fixturePagos.at(-1), resumen:{completado:true, pendiente:0}};
    }
    window.savedRenewal = b;
    fixtureMem.version++;
    fixtureMem.estado = 'activo';
    fixtureMem.precio = b.precio_acordado;
    fixtureMem.total_pagado = b.precio_acordado;
    fixtureMem.periodos = [
      {inicial:true, plan_nombre:'Mensual', fecha_inicio:'2026-01-01', fecha_fin:'2026-02-01', monto_total:80},
      {plan_nombre:'Trimestral', fecha_inicio:b.fecha_inicio, fecha_fin:'2027-01-01',
        monto_total:b.precio_acordado, notas:'<img src=x onerror=alert(1)>'}
    ];
    return {membresia:structuredClone(fixtureMem)};
  }
};
window.addEventListener('error',e=>window.smokeError=e.message);
window.addEventListener('unhandledrejection',e=>window.smokeError=String(e.reason));
</script>`;
const checks = `<script>
(async()=>{try{
 const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timeout de interfaz')};
 const el=id=>document.getElementById('renovar-'+id);
 if(document.getElementById('pagos-table')){
   await wait(()=>document.querySelectorAll('#pagos-table tr').length===3);
   const rows=[...document.querySelectorAll('#pagos-table tr')];
   if(!rows.find(row=>row.textContent.includes('Gratis'))?.textContent.includes('Pagado'))throw new Error('Periodo gratuito se interpreta como deuda');
   await abrirAbonoDesdePago('mem1',null,100,'per1');
   await wait(()=>document.getElementById('abono-mem-id').dataset.periodoId==='per1');
   if(document.getElementById('abono-monto').max!=='50')throw new Error('Mezcla saldos de periodos');
   document.getElementById('abono-monto').value='50';await guardarAbono();
   if(savedAbono.periodo_id!=='per1')throw new Error('Abono sin periodo');
   if(document.querySelectorAll('#pagos-table tr').length!==3)throw new Error('Abono duplica periodo');
   if(window.smokeError)throw new Error(window.smokeError);
   parent.document.body.dataset.smoke='PASS';return;
 }
 await wait(()=>document.querySelector('[data-renovar="mem1"]'));
 await abrirRenovar('mem1');
 if(el('precio').value!=='100')throw new Error('Reutiliza descuento anterior');
 if(el('inicio').readOnly)throw new Error('Fecha vencida no editable');
 el('descuento').value='20';el('descuento').dispatchEvent(new Event('input'));
 if(el('precio').value!=='80')throw new Error('Descuento no recalcula precio');
 el('restaurar').click();if(el('precio').value!=='100')throw new Error('No elimina descuento');
 el('plan').value='plan2';el('plan').dispatchEvent(new Event('change'));
 if(el('precio').value!=='270')throw new Error('Plan no actualiza precio');
 el('precio').value='250';el('precio').dispatchEvent(new Event('input'));
 el('estado-pago').value='abono';el('estado-pago').dispatchEvent(new Event('input'));
 el('abono').value='50';el('abono').dispatchEvent(new Event('input'));
 if(!el('monto-final').textContent.includes('200'))throw new Error('Saldo incorrecto');
 if(document.getElementById('modal-renovar').querySelector('.modal').getBoundingClientRect().width>innerWidth)throw new Error('Modal desborda viewport');
 await renovar();
 if(savedRenewal.plan_id!=='plan2'||savedRenewal.precio_acordado!==250||savedRenewal.monto!==50)throw new Error('Contrato enviado incorrecto');
 if(document.querySelectorAll('#membresias-table tr').length!==1)throw new Error('Duplica fila al renovar');
 await verPeriodos('mem1');
 if(document.getElementById('periodos-lista').querySelector('img'))throw new Error('Historial inserta HTML sin escapar');
 document.getElementById('btn-close-periodos').click();
 fixtureMem.fecha_fin=new Date(Date.now()+5*86400000).toISOString();
 await abrirRenovar('mem1');if(!el('inicio').readOnly)throw new Error('Renovación activa permite adelantar plan');
 closeModal('modal-renovar');fixtureMem.saldo_total=40;
 await abrirRenovar('mem1');if(!document.getElementById('modal-renovar').classList.contains('hidden'))throw new Error('Deuda no bloquea renovación');
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
      res.end(`<html><body><iframe title="Prueba" src="/${url.searchParams.get('page')}.html?theme=${url.searchParams.get('theme')}" style="width:${Number(url.searchParams.get('width'))}px;height:1000px;border:0"></iframe></body></html>`);
      return;
    }
    const file = path.resolve(publicDir, '.' + url.pathname);
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    if (['/membresias.html', '/pagos.html'].includes(url.pathname)) {
      const html = fs.readFileSync(file, 'utf8').replace('<head>', '<head>' + mock)
        .replace('<script src="/js/api.js"></script>', '')
        .replace(/initLayout\('(membresias|pagos)', '[^']+'\);/, '');
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
    profile = fs.mkdtempSync(path.join(temp, 'membresias-browser-'));
    for (const page of ['membresias', 'pagos']) {
      for (const width of [1440, 375]) {
        for (const theme of ['light', 'dark']) {
          const { stdout } = await run(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            `--user-data-dir=${profile}`, '--window-size=1600,1100', '--virtual-time-budget=10000', '--dump-dom',
            `http://127.0.0.1:${server.address().port}/?page=${page}&width=${width}&theme=${theme}`], { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
          const result = stdout.match(/data-smoke="([^"]+)"/)?.[1];
          if (result !== 'PASS') throw new Error(`${page} ${width}px ${theme}: ${result || 'sin resultado'}`);
          console.log(`PASS: ${page} ${width}px ${theme} — renovación o pagos por periodo.`);
        }
      }
    }
  } finally {
    server.close();
    if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
