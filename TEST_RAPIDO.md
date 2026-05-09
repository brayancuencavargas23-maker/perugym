# 🔥 TEST RÁPIDO - Ejecuta esto en la consola del navegador

## 📋 Copia y pega este código en la consola (F12 → Console):

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// 🔥 TEST RÁPIDO DE CLIENTES
// ═══════════════════════════════════════════════════════════════════════════

console.clear();
console.log('%c🔥 TEST RÁPIDO DE CLIENTES', 'font-size:18px;font-weight:bold;color:#ff4444;background:#000;padding:10px');

// 1. Verificar que estamos en la página correcta
console.log('\n%c1️⃣ VERIFICACIÓN DE PÁGINA', 'font-weight:bold;color:#0d6efd');
const url = window.location.href;
console.log('URL actual:', url);
console.log('¿Es página de clientes?', url.includes('clientes'));

// 2. Verificar elementos del DOM
console.log('\n%c2️⃣ ELEMENTOS DEL DOM', 'font-weight:bold;color:#0d6efd');
const tabla = document.getElementById('clientes-table');
console.log('Tabla existe:', !!tabla);
if (tabla) {
  console.log('Contenido actual de la tabla:', tabla.innerHTML);
  console.log('Número de filas:', tabla.querySelectorAll('tr').length);
}

// 3. Verificar funciones
console.log('\n%c3️⃣ FUNCIONES DISPONIBLES', 'font-weight:bold;color:#0d6efd');
console.log('loadClientes:', typeof loadClientes);
console.log('api:', typeof api);
console.log('gymCache:', typeof gymCache);

// 4. Verificar token
console.log('\n%c4️⃣ AUTENTICACIÓN', 'font-weight:bold;color:#0d6efd');
const token = localStorage.getItem('gym_token');
console.log('Token existe:', !!token);
if (token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    console.log('Token payload:', payload);
    console.log('Token expirado:', payload.exp * 1000 < Date.now());
  } catch (e) {
    console.error('Error al decodificar token:', e);
  }
}

// 5. Verificar caché
console.log('\n%c5️⃣ CACHÉ', 'font-weight:bold;color:#0d6efd');
if (typeof gymCache !== 'undefined') {
  const cached = gymCache.get('/clientes?page=1&limit=15');
  console.log('Datos en caché:', cached);
}

// 6. PRUEBA DIRECTA DE API
console.log('\n%c6️⃣ PRUEBA DIRECTA DE API', 'font-weight:bold;color:#ff4444;font-size:14px');
console.log('Intentando cargar clientes directamente desde la API...');

if (typeof api !== 'undefined') {
  api.get('/clientes?page=1&limit=15', true)
    .then(data => {
      console.log('%c✅ ÉXITO - Datos recibidos:', 'color:#198754;font-weight:bold', data);
      console.log('Total de clientes:', data.total);
      console.log('Clientes en esta página:', data.data.length);
      console.table(data.data);
      
      // Intentar renderizar manualmente
      if (tabla && data.data.length > 0) {
        console.log('\n%c7️⃣ RENDERIZADO MANUAL', 'font-weight:bold;color:#0d6efd');
        console.log('Intentando renderizar en la tabla...');
        
        const html = data.data.map(c => `
          <tr>
            <td>${c.nombre}</td>
            <td>${c.dni || '-'}</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
          </tr>
        `).join('');
        
        tabla.innerHTML = html;
        console.log('✅ Tabla renderizada manualmente');
      }
    })
    .catch(err => {
      console.error('%c❌ ERROR - No se pudieron cargar los clientes:', 'color:#dc3545;font-weight:bold', err);
      console.error('Mensaje:', err.message);
      console.error('Stack:', err.stack);
    });
} else {
  console.error('❌ La función api no está disponible');
}

// 7. Verificar si loadClientes está definida y ejecutarla
console.log('\n%c8️⃣ EJECUTAR loadClientes()', 'font-weight:bold;color:#0d6efd');
if (typeof loadClientes === 'function') {
  console.log('Ejecutando loadClientes()...');
  loadClientes(1)
    .then(() => console.log('✅ loadClientes() completado'))
    .catch(err => console.error('❌ Error en loadClientes():', err));
} else {
  console.error('❌ loadClientes no está definida');
}

console.log('\n' + '═'.repeat(80));
console.log('%c🔍 REVISA LOS RESULTADOS ARRIBA', 'font-size:14px;font-weight:bold;color:#6c63ff');
```

---

## 🎯 QUÉ ESPERAR:

### ✅ Si todo funciona bien:
```
✅ ÉXITO - Datos recibidos: {data: Array(X), total: X, ...}
Total de clientes: X
Clientes en esta página: X
✅ Tabla renderizada manualmente
```

### ❌ Si hay un error:
```
❌ ERROR - No se pudieron cargar los clientes: Error: ...
```

---

## 📸 DESPUÉS DE EJECUTAR:

1. **Toma captura de TODO el output**
2. **Verifica si la tabla se llenó** (debería mostrar los clientes)
3. **Envíame la captura**

---

## 🔧 SI LA TABLA SE LLENA CON ESTE SCRIPT:

Significa que:
- ✅ El API funciona
- ✅ Los datos existen
- ✅ El problema está en la inicialización automática

**Solución:** Necesitamos ajustar el timing de la inicialización.

---

## 🔧 SI LA TABLA NO SE LLENA:

Significa que:
- ❌ Hay un error en el API
- ❌ No hay datos en la base de datos
- ❌ Problema de autenticación

**Solución:** Revisar el backend y la base de datos.
