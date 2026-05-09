# 🧪 INSTRUCCIONES DE PRUEBA

## 📋 Pasos para Verificar la Solución

### 1️⃣ **Preparación**

1. Abre tu navegador (Chrome, Edge, Firefox)
2. Presiona **F12** para abrir DevTools
3. Ve a la pestaña **Console**
4. Limpia la consola (botón 🚫 o Ctrl+L)

---

### 2️⃣ **Prueba Básica - Clientes**

1. **Inicia sesión** en tu aplicación
2. Desde el **Dashboard**, haz click en **"Clientes"** en el sidebar
3. **Observa la consola**, deberías ver:

```
[Clientes] 🚀 Iniciando página...
[Clientes] ✅ Tabla encontrada
[Clientes] 🔄 Cargando datos...
[Clientes] 📥 loadClientes(1) iniciado
[Clientes] 🌐 Fetching: /clientes?page=1&limit=15
[API] GET /api/clientes?page=1&limit=15
[API] ✅ GET /clientes?page=1&limit=15 - OK
[Clientes] ✅ Datos recibidos: {data: Array(X), ...}
[Clientes] ✅ Tabla renderizada con X filas
```

4. **Verifica que la tabla muestre los clientes**

✅ **ÉXITO:** Si ves los logs y los datos en la tabla
❌ **FALLO:** Si no ves logs o la tabla está vacía

---

### 3️⃣ **Prueba Básica - Solicitudes**

1. Haz click en **"Solicitudes"** en el sidebar
2. **Observa la consola**, deberías ver:

```
[Solicitudes] 🚀 Iniciando página...
[Solicitudes] ✅ Tabla encontrada
[Solicitudes] 🔄 Verificando caja...
[Solicitudes] ✅ Caja verificada: {id: "...", ...}
[Solicitudes] 🔄 Cargando estadísticas...
[API] GET /api/solicitudes/stats
[API] ✅ GET /solicitudes/stats - OK
[Solicitudes] ✅ Estadísticas cargadas
[Solicitudes] 🔄 Cargando solicitudes...
[Solicitudes] 📥 loadSolicitudes(1, force=false) iniciado
[Solicitudes] 🌐 Fetching: /solicitudes?page=1&limit=15
[API] GET /api/solicitudes?page=1&limit=15
[API] ✅ GET /solicitudes?page=1&limit=15 - OK
[Solicitudes] ✅ Datos recibidos: {data: Array(X), ...}
[Solicitudes] ✅ Tabla renderizada con X filas
[Solicitudes] ✅ Conteo inicial: X
[Solicitudes] 🔄 Iniciando polling...
[Solicitudes] ✅ Polling iniciado
```

3. **Verifica que:**
   - La tabla muestre las solicitudes
   - Los badges de estado (🟡 Pendientes, 🔵 Contactados, etc.) muestren números
   - No haya errores en rojo

✅ **ÉXITO:** Si ves los logs y los datos
❌ **FALLO:** Si hay errores o la tabla está vacía

---

### 4️⃣ **Prueba de Navegación Múltiple**

1. Navega entre diferentes páginas usando el sidebar:
   - Dashboard → Clientes → Solicitudes → Planes → Clientes

2. **Observa que:**
   - Cada navegación muestra sus logs correspondientes
   - Los datos se cargan correctamente cada vez
   - No hay errores acumulados

✅ **ÉXITO:** Navegación fluida sin errores
❌ **FALLO:** Errores o páginas en blanco

---

### 5️⃣ **Prueba de Caché**

1. Ve a **Clientes**
2. Espera a que cargue completamente
3. Ve a **Dashboard**
4. Regresa a **Clientes**

**Observa en los logs:**
```
[Clientes] 🚀 Iniciando página...
[Clientes] ✅ Tabla encontrada
[Clientes] 🔄 Cargando datos...
[Clientes] 📥 loadClientes(1) iniciado
[Clientes] 🌐 Fetching: /clientes?page=1&limit=15
```

**NO debería aparecer:**
```
[API] GET /api/clientes?page=1&limit=15
```

Porque los datos vienen del **caché** (sessionStorage).

✅ **ÉXITO:** Segunda carga es instantánea (sin petición HTTP)
❌ **FALLO:** Siempre hace petición HTTP

---

### 6️⃣ **Prueba de Errores Simulados**

#### A. Simular error de red:

1. Abre DevTools → **Network** tab
2. Cambia el throttling a **"Offline"**
3. Navega a **Clientes**

**Deberías ver:**
```
[Clientes] 🚀 Iniciando página...
[Clientes] ✅ Tabla encontrada
[Clientes] 🔄 Cargando datos...
[Clientes] 📥 loadClientes(1) iniciado
[Clientes] 🌐 Fetching: /clientes?page=1&limit=15
[API] GET /api/clientes?page=1&limit=15
[API] ❌ Error en GET /clientes?page=1&limit=15: TypeError: Failed to fetch
[Clientes] ❌ Error en loadClientes: TypeError: Failed to fetch
```

**Y un toast rojo con el mensaje de error**

4. Vuelve a poner **"No throttling"**

✅ **ÉXITO:** Error visible en consola y toast
❌ **FALLO:** Página en blanco sin feedback

---

#### B. Simular token expirado:

1. En la consola, ejecuta:
```javascript
localStorage.setItem('gym_token', 'token_invalido_123');
```

2. Navega a **Clientes**

**Deberías ver:**
```
[API] GET /api/clientes?page=1&limit=15
[API] ❌ 401 Unauthorized - Cerrando sesión
```

**Y ser redirigido a /login.html**

✅ **ÉXITO:** Redirige a login automáticamente
❌ **FALLO:** Se queda en la página sin hacer nada

---

### 7️⃣ **Prueba del Script de Diagnóstico**

1. Navega a **Clientes**
2. Copia y pega en la consola el script de `DEBUG_SCRIPT.md`
3. Presiona Enter

**Deberías ver un reporte completo:**
```
🔍 DIAGNÓSTICO DE CARGA DE DATOS
════════════════════════════════════════════════════════════

1️⃣ ELEMENTOS DEL DOM
  ✅ #clientes-table: <tbody id="clientes-table">...</tbody>
  ❌ #solicitudes-table: NO EXISTE
  ✅ #search: <input type="text" id="search" ...>
  ✅ #filter-activo: <select id="filter-activo" ...>
  ❌ #filter-estado: NO EXISTE
  ✅ #spa-content: <div class="page-content" id="spa-content">...</div>

2️⃣ FUNCIONES GLOBALES
  ✅ loadClientes: function
  ❌ loadSolicitudes: NO DEFINIDA
  ✅ api: object
  ✅ gymCache: object
  ✅ icon: function
  ✅ toast: function
  ✅ initLayout: function
  ✅ GymRouter: object

3️⃣ VARIABLES DE PÁGINA
  ✅ currentPage: 1
  ❌ cajaActual: NO DEFINIDA
  ❌ _lastPendingCount: NO DEFINIDA
  ❌ _pollingTimer: NO DEFINIDA

4️⃣ AUTENTICACIÓN
  Token: ✅ eyJhbGciOiJIUzI1NiIs...
  Usuario: ✅ Admin User

5️⃣ ESTADO DEL CACHÉ
  Total entradas: 3
    • /clientes?page=1&limit=15 (clientes) - 45s - ✅ VÁLIDO
    • /planes (planes) - 120s - ✅ VÁLIDO
    • /solicitudes/stats (solicitudes) - 30s - ✅ VÁLIDO

6️⃣ PRUEBA DE CARGA MANUAL
  🔄 Intentando cargar clientes...
  ✅ Clientes cargados exitosamente

7️⃣ PETICIONES DE RED
  Abre la pestaña Network y verifica si hay peticiones a:
    • /api/clientes
    • /api/solicitudes
    • /api/solicitudes/stats

8️⃣ MODO SPA
  __SPA_SHELL__: ✅ ACTIVO
  GymRouter: ✅ DISPONIBLE

════════════════════════════════════════════════════════════
✅ DIAGNÓSTICO COMPLETO
```

✅ **ÉXITO:** Reporte completo sin errores críticos
❌ **FALLO:** Muchos elementos marcados como NO EXISTE

---

### 8️⃣ **Prueba de Rendimiento**

1. Abre DevTools → **Performance** tab
2. Haz click en el botón de grabar (⚫)
3. Navega de **Dashboard** a **Clientes**
4. Detén la grabación

**Analiza:**
- El tiempo total de carga debería ser < 500ms
- No debería haber "Long Tasks" (tareas > 50ms)
- El skeleton loader debería aparecer brevemente

✅ **ÉXITO:** Carga rápida y fluida
❌ **FALLO:** Carga lenta o bloqueos

---

## 🔍 CHECKLIST FINAL

Marca cada ítem después de probarlo:

### Funcionalidad Básica
- [ ] Clientes carga correctamente
- [ ] Solicitudes carga correctamente
- [ ] Los logs aparecen en consola
- [ ] Las tablas muestran datos
- [ ] No hay errores en consola

### Navegación
- [ ] Navegación entre páginas funciona
- [ ] El sidebar marca la página activa
- [ ] El título del topbar se actualiza
- [ ] No hay parpadeos o flashes

### Caché
- [ ] Primera carga hace petición HTTP
- [ ] Segunda carga usa caché
- [ ] Caché expira después del TTL
- [ ] Invalidación de caché funciona

### Manejo de Errores
- [ ] Errores de red se muestran en consola
- [ ] Errores de red muestran toast al usuario
- [ ] Token expirado redirige a login
- [ ] Errores 403 muestran mensaje apropiado

### Rendimiento
- [ ] Carga inicial < 500ms
- [ ] Skeleton loader aparece
- [ ] No hay bloqueos del UI
- [ ] Navegación es fluida

### Debugging
- [ ] Script de diagnóstico funciona
- [ ] Logs son claros y útiles
- [ ] Fácil identificar problemas
- [ ] Información suficiente para debuggear

---

## 🐛 PROBLEMAS COMUNES Y SOLUCIONES

### Problema: "No veo ningún log en consola"

**Posibles causas:**
1. Los logs están filtrados
2. La consola está en otro nivel (solo Errors)
3. Los scripts no se están ejecutando

**Solución:**
1. Limpia los filtros de la consola
2. Asegúrate de que "All levels" esté seleccionado
3. Recarga la página con Ctrl+Shift+R

---

### Problema: "Veo los logs pero la tabla está vacía"

**Posibles causas:**
1. No hay datos en la base de datos
2. Error en el backend
3. Problema de permisos

**Solución:**
1. Verifica los logs de la API
2. Revisa la pestaña Network para ver la respuesta
3. Ejecuta el script de diagnóstico

---

### Problema: "Los datos no se actualizan"

**Posibles causas:**
1. Caché no se está invalidando
2. TTL muy largo
3. Problema con sessionStorage

**Solución:**
1. Limpia el caché manualmente: `gymCache.clear()`
2. Recarga con Ctrl+Shift+R
3. Verifica sessionStorage en DevTools → Application

---

### Problema: "Error: Cannot read property 'innerHTML' of null"

**Posibles causas:**
1. El elemento no existe en el DOM
2. Timing issue (aunque debería estar resuelto)
3. ID incorrecto

**Solución:**
1. Verifica que el elemento existe: `console.log(document.getElementById('clientes-table'))`
2. Revisa el HTML de la página
3. Ejecuta el script de diagnóstico

---

## 📊 MÉTRICAS DE ÉXITO

### ✅ TODO FUNCIONA SI:

1. **Logs completos:** Ves todos los logs esperados en consola
2. **Datos visibles:** Las tablas muestran información
3. **Sin errores:** No hay mensajes rojos en consola
4. **Navegación fluida:** Cambiar de página es instantáneo
5. **Caché funciona:** Segunda visita es más rápida
6. **Errores manejados:** Los errores muestran feedback útil

### ❌ HAY PROBLEMAS SI:

1. **Sin logs:** No aparece nada en consola
2. **Tablas vacías:** No se muestran datos
3. **Errores rojos:** Hay excepciones no manejadas
4. **Navegación lenta:** Tarda más de 1 segundo
5. **Sin caché:** Siempre hace peticiones HTTP
6. **Errores silenciosos:** Fallos sin feedback

---

## 🎯 PRÓXIMOS PASOS

Si todas las pruebas pasan:

1. ✅ **Desplegar a producción**
2. ✅ **Monitorear logs en producción**
3. ✅ **Aplicar el mismo patrón a otras páginas**
4. ✅ **Documentar para el equipo**
5. ✅ **Crear tests automatizados**

Si hay fallos:

1. ❌ **Revisar los logs de error**
2. ❌ **Ejecutar el script de diagnóstico**
3. ❌ **Verificar el backend**
4. ❌ **Revisar la documentación**
5. ❌ **Pedir ayuda con logs completos**

---

## 📞 SOPORTE

Si después de todas las pruebas sigues teniendo problemas:

1. **Captura de pantalla** de la consola completa
2. **Captura de pantalla** de la pestaña Network
3. **Resultado** del script de diagnóstico
4. **Descripción** del problema paso a paso

Con esa información será mucho más fácil ayudarte.

---

## ✅ CONCLUSIÓN

Estas pruebas te ayudarán a:

- ✅ Verificar que la solución funciona
- ✅ Entender cómo funciona el sistema
- ✅ Identificar problemas rápidamente
- ✅ Aprender a debuggear SPAs
- ✅ Ganar confianza en el código

**¡Buena suerte con las pruebas!** 🚀
