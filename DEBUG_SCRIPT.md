# 🔍 Script de Diagnóstico para Clientes y Solicitudes

## Ejecuta esto en la consola del navegador cuando estés en la página de Clientes o Solicitudes:

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// 🔍 DIAGNÓSTICO COMPLETO - Clientes y Solicitudes
// ═══════════════════════════════════════════════════════════════════════════

console.clear();
console.log('%c🔍 DIAGNÓSTICO DE CARGA DE DATOS', 'font-size:16px;font-weight:bold;color:#6c63ff');
console.log('═'.repeat(60));

// ── 1. Verificar elementos del DOM ──────────────────────────────────────────
console.log('\n%c1️⃣ ELEMENTOS DEL DOM', 'font-weight:bold;color:#0d6efd');
const elementos = {
  'clientes-table': document.getElementById('clientes-table'),
  'solicitudes-table': document.getElementById('solicitudes-table'),
  'search': document.getElementById('search'),
  'filter-estado': document.getElementById('filter-estado'),
  'filter-activo': document.getElementById('filter-activo'),
  'spa-content': document.getElementById('spa-content'),
};

Object.entries(elementos).forEach(([id, el]) => {
  console.log(`  ${el ? '✅' : '❌'} #${id}:`, el || 'NO EXISTE');
});

// ── 2. Verificar funciones globales ─────────────────────────────────────────
console.log('\n%c2️⃣ FUNCIONES GLOBALES', 'font-weight:bold;color:#0d6efd');
const funciones = [
  'loadClientes', 'loadSolicitudes', 'loadStats',
  'checkCaja', 'api', 'gymCache', 'icon', 'toast',
  'initLayout', 'GymRouter'
];

funciones.forEach(fn => {
  const existe = typeof window[fn] !== 'undefined';
  console.log(`  ${existe ? '✅' : '❌'} ${fn}:`, existe ? typeof window[fn] : 'NO DEFINIDA');
});

// ── 3. Verificar variables de página ────────────────────────────────────────
console.log('\n%c3️⃣ VARIABLES DE PÁGINA', 'font-weight:bold;color:#0d6efd');
const variables = ['currentPage', 'cajaActual', '_lastPendingCount', '_pollingTimer'];
variables.forEach(v => {
  const existe = typeof window[v] !== 'undefined';
  console.log(`  ${existe ? '✅' : '❌'} ${v}:`, existe ? window[v] : 'NO DEFINIDA');
});

// ── 4. Verificar token y usuario ────────────────────────────────────────────
console.log('\n%c4️⃣ AUTENTICACIÓN', 'font-weight:bold;color:#0d6efd');
const token = localStorage.getItem('gym_token');
const user = localStorage.getItem('gym_user');
console.log('  Token:', token ? `✅ ${token.substring(0, 20)}...` : '❌ NO EXISTE');
console.log('  Usuario:', user ? `✅ ${JSON.parse(user).name}` : '❌ NO EXISTE');

// ── 5. Verificar caché ──────────────────────────────────────────────────────
console.log('\n%c5️⃣ ESTADO DEL CACHÉ', 'font-weight:bold;color:#0d6efd');
if (typeof gymCache !== 'undefined') {
  const stats = gymCache.stats();
  console.log(`  Total entradas: ${stats.length}`);
  stats.forEach(s => {
    console.log(`    • ${s.key} (${s.namespace}) - ${s.age} - ${s.expired ? '⏰ EXPIRADO' : '✅ VÁLIDO'}`);
  });
} else {
  console.log('  ❌ gymCache no está definido');
}

// ── 6. Intentar cargar datos manualmente ────────────────────────────────────
console.log('\n%c6️⃣ PRUEBA DE CARGA MANUAL', 'font-weight:bold;color:#0d6efd');

// Detectar qué página estamos viendo
const isClientes = !!document.getElementById('clientes-table');
const isSolicitudes = !!document.getElementById('solicitudes-table');

if (isClientes && typeof loadClientes === 'function') {
  console.log('  🔄 Intentando cargar clientes...');
  loadClientes(1)
    .then(() => console.log('  ✅ Clientes cargados exitosamente'))
    .catch(err => console.error('  ❌ Error al cargar clientes:', err));
}

if (isSolicitudes && typeof loadSolicitudes === 'function') {
  console.log('  🔄 Intentando cargar solicitudes...');
  loadSolicitudes(1)
    .then(() => console.log('  ✅ Solicitudes cargadas exitosamente'))
    .catch(err => console.error('  ❌ Error al cargar solicitudes:', err));
}

// ── 7. Verificar peticiones de red ──────────────────────────────────────────
console.log('\n%c7️⃣ PETICIONES DE RED', 'font-weight:bold;color:#0d6efd');
console.log('  Abre la pestaña Network y verifica si hay peticiones a:');
console.log('    • /api/clientes');
console.log('    • /api/solicitudes');
console.log('    • /api/solicitudes/stats');

// ── 8. Verificar modo SPA ───────────────────────────────────────────────────
console.log('\n%c8️⃣ MODO SPA', 'font-weight:bold;color:#0d6efd');
console.log('  __SPA_SHELL__:', window.__SPA_SHELL__ ? '✅ ACTIVO' : '❌ INACTIVO');
console.log('  GymRouter:', typeof GymRouter !== 'undefined' ? '✅ DISPONIBLE' : '❌ NO DISPONIBLE');

console.log('\n' + '═'.repeat(60));
console.log('%c✅ DIAGNÓSTICO COMPLETO', 'font-size:14px;font-weight:bold;color:#198754');
```

## 📋 Qué hacer después:

1. **Copia todo el código de arriba**
2. **Pega en la consola del navegador** (F12 → Console)
3. **Presiona Enter**
4. **Toma captura de pantalla** de TODO el output
5. **Envíamela** para analizar

---

## 🎯 También prueba esto para forzar la carga:

```javascript
// Forzar carga de clientes (si estás en esa página)
if (typeof loadClientes === 'function') {
  console.log('🔄 Forzando carga de clientes...');
  loadClientes(1).catch(err => console.error('Error:', err));
}

// Forzar carga de solicitudes (si estás en esa página)
if (typeof loadSolicitudes === 'function') {
  console.log('🔄 Forzando carga de solicitudes...');
  loadSolicitudes(1).catch(err => console.error('Error:', err));
}
```

---

## 🔧 Si quieres ver los datos crudos del API:

```javascript
// Ver clientes directamente desde el API
api.get('/clientes?page=1&limit=15', true)
  .then(data => {
    console.log('📦 Datos de clientes:', data);
    console.table(data.data);
  })
  .catch(err => console.error('❌ Error:', err));

// Ver solicitudes directamente desde el API
api.get('/solicitudes?page=1&limit=15', true)
  .then(data => {
    console.log('📦 Datos de solicitudes:', data);
    console.table(data.data);
  })
  .catch(err => console.error('❌ Error:', err));
```
