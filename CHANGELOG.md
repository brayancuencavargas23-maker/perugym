# PeruGym - Registro de Cambios

## Login rediseñado: panel de marca con mancuerna 3D + formulario

### Mejora de diseño
La página de login pasa de una tarjeta centrada sobre un degradado a un **layout de dos paneles**: a la izquierda, la marca del gimnasio con la **mancuerna 3D** (`visor_3d_mancuerna.html`) integrada en el propio panel; a la derecha, la tarjeta con el formulario.

- **Retícula 12 → 6:** `grid` de 2 columnas (7fr/5fr) con corte en 960 px; en móvil el panel de marca se compacta (260 px) y se ocultan los puntos de venta para priorizar el formulario.
- **Regla 60-30-10 con un solo acento:** 60% superficie neutra (`--bg`/paneles), 30% tipografía y tarjetas, 10% esmeralda (`#10b981`) solo en marca, checks, foco y CTA. Sin azules del visor original.
- **Escalas tipográficas** 40/32/24/16/14/13 px y tokens semánticos del tema (claro/oscuro se aplica en el login con `gym_theme`, antes solo con `layout.js`).
- **3D contenido, no a pantalla completa:** el lienzo se ajusta al panel (`ResizeObserver` + encuadre por FOV), respeta `prefers-reduced-motion` (sin rotación ni parpadeo de partículas) y tiene **fallback con icono** si WebGL/Three.js no cargan.
- **Logo de marca:** `imagenes/index/sidebarlogo.png` (arte blanco sobre fondo transparente) en los dos puntos de marca: chip esmeralda del panel izquierdo (68 px) y chip de la cabecera de la tarjeta de login (56 px).
- **CSP respetada:** Three.js r128 desde `cdnjs.cloudflare.com` (permitido); se eliminaron Tailwind CDN, Font Awesome y Google Fonts del visor original porque la CSP de `server.js` los bloquearía. Iconografía con `icons.js`.
- Luces y partículas del visor repintadas en esmeralda (key blanca + fill/rim esmeralda).

### Archivos modificados
- `public/login.html` — reescrito (estructura 2 paneles + script 3D adaptado); toda la lógica previa se conserva (guard bfcache, panel de sesión activa, submit, limpieza de campos).

---

## Sesión y login: renovación deslizante, semántica 401/403 y rate limit por cuenta

### Problemática
Tras 7 días (la vida del JWT) una máquina dejaba de entrar: en el mejor caso "Sesión expirada", en el peor **"Demasiados intentos de inicio de sesión"** aunque la contraseña fuera correcta, mientras que desde otra red sí ingresaba. Además, una sesión vencida mostraba "No tienes permiso" en bucle y la PC compartida de recepción heredaba la sesión del turno anterior.

**Causas encontradas:**
1. **Rate limit por IP con cupo compartido:** `express-rate-limit` estaba montado **antes** de los body parsers y con `max: 10` / 15 min **contando también los logins exitosos** (`skipSuccessfulRequests` no estaba activo). Cualquier racha de 10 peticiones en 15 min agotaba la IP → 429 incluso con credenciales válidas. Como la clave era la IP, una sola conexión (o un colega detrás del mismo NAT) bloqueaba a los demás → el síntoma "en esta red no entra, en la otra sí".
2. **Vida fija de 7 días** (`JWT_EXPIRES_IN=7d`) sin renovación: al vencer, corte seco y re-login obligado.
3. **Semántica 401/403 invertida:** `verifyToken` devolvía **403** "Token inválido o expirado" pero `api.js` solo cierra sesión ante **401** → el 403 se traducía en "No tienes permiso" (el dashboard lo repetía cada 60 s por su auto-refresh) y no había logout real.
4. **Sin `trust proxy`:** detrás de un proxy inverso `req.ip` sería la IP del proxy y **todos** los usuarios compartirían el mismo contador.
5. **Auto-logout incompleto:** la ruta 401 limpiaba `gym_cache` pero no `_sidebar_html` (sidebar del usuario anterior heredado).
6. **Login en PC compartida:** con token válido, `login.html` redirigía en silencio al panel → el siguiente turno entraba como el usuario anterior.
7. **Privilegios stale:** `requireRole` leía `role` del token (hasta 7 días viejo) y un fallo transitorio de BD devolvía **401** (expulsión injustificada).

### Solución implementada
- **Renovación deslizante** (`POST /api/auth/refresh`): mientras haya actividad se emite un token nuevo con datos frescos de BD; la sesión solo vence tras 7 días de inactividad (o si desactivan al usuario). El cliente la renueva cuando quedan <10 min y avisa si no es posible (`utils.js: startSessionKeeper`).
- **Rate limit por IP *y* por cuenta**, ambos con `skipSuccessfulRequests` (30 fallos/15 min por IP, 10 fallos/15 min por cuenta) y montado **después** de `express.json()` para leer `req.body.username`.
- **`verifyToken`:** token inválido/expirado → **401** (logout real en el cliente); error de BD → **503** (no expulsa); `role`/`permisos` se recargan **desde la BD** en cada petición.
- **`api.js`:** el auto-logout ahora limpia `sessionStorage` completo (`gym_cache` + `_sidebar_html`).
- **`login.html`:** con sesión activa muestra *"Ya hay una sesión activa — Conectado como X"* con **Continuar sesión** / **Cambiar de usuario** en vez de redirigir en silencio.
- **Cierre por inactividad:** 60 min sin interacción del usuario → aviso a los 59 min y logout automático (solo los eventos de entrada cuentan como actividad, no las llamadas API).
- **`TRUST_PROXY`** (`.env`, comentado): activar en 1 si hay nginx/Render/Cloudflare delante para que el rate limit use la IP real.

### Archivos modificados
- `server.js` — `trust proxy` configurable + doble limitador de login tras los body parsers.
- `middleware/auth.js` — 401 para JWT, 503 para BD, rol/permisos frescos.
- `routes/auth.js` — nuevo `POST /api/auth/refresh`.
- `public/js/api.js` — `sessionStorage.clear()` en el auto-logout.
- `public/js/utils.js` — `startSessionKeeper()` (renovación, aviso, inactividad).
- `public/login.html` — panel "Continuar sesión / Cambiar de usuario".
- `tests/unit/middleware/auth.test.js` — 401 en vez de 403 + 3 tests nuevos (token expirado, rol fresco, 503 en BD).

### Verificación
`npx jest tests/unit tests/regression tests/integration` → **149/149 tests en verde**. Smoke test del rate limit: 11º intento de la misma cuenta → 429; otra cuenta en la misma IP → 200; 15 logins exitosos seguidos no consumen cupo.

---

## Rediseño del Dashboard (sistema de diseño unificado)

### Problemática
El dashboard acumulaba dos identidades de marca (verde esmeralda `#10b981` y morado residual `#6c63ff`), 6–7 colores decorativos por pantalla, gradientes en casi todas las superficies, tarjetas de alturas desiguales que dejaban huecos en la grilla de 2 columnas, tipografía sin escala y estilos duplicados/inline que chocaban con `main.css` (p. ej. `.badge-warning` definida dos veces con valores distintos).

### Reglas aplicadas
- **Un solo acento** (esmeralda) + escala semántica (`success/warning/danger/info`) usada **solo para estado**.
- **60‑30‑10**: superficies neutras (`--card-bg` + borde `--border`), color únicamente en iconos, badges y CTA.
- **Retícula de 12 columnas** donde cada fila suma 12 (3+3+3+3 / 5+7 / 4+4+4 / 6+6 / 12) → sin espacios sin aprovechar.
- Escala tipográfica 11/12/13/14/18/22/24/30 con `font-variant-numeric: tabular-nums` en cifras.
- Ritmo de espaciado 4/8 (gap 20, padding 18/20, filas 10/12).
- Contraste AA: texto de enlaces/botones activos en `--accent-700`, `--on-primary` para texto sobre fondos esmeralda (claro y oscuro).
- Accesibilidad: `prefers-reduced-motion`, `aria-hidden` en SVG decorativos, `aria-pressed`/`aria-label`/labels con `for`, severidad con texto además de color.

### Archivos modificados
- `public/dashboard.html` — Reescritura del bloque `<style>` y del markup: KPIs neutros (color solo en el icono, rojo reservado a "Pagos Pendientes"), sin medallas oro/plata/bronce, sin gradiente en el total de ingresos, listas con clases reutilizables (`.list`, `.list-row`, `.empty-state`, `.dash-section-header`), FAB movido dentro de `.page-content` (el router SPA descartaba el que estaba fuera), botón Cancelar con listener en vez de `onclick` inline (no funciona dentro del IIFE del router), timer de auto-refresh en `window.__dashRefresh` para no acumular intervalos entre visitas.
- `public/dashboard.html` (JS) — Chart.js ahora lee los tokens del tema activo (`--primary`, `--text-light`, color de grilla) y repinta al cambiar claro/oscuro (el `<canvas>` no interpreta variables CSS); se eliminaron los hex sueltos (`#198754`, `#dc3545`, `#28a745`) a favor de tokens.
- `public/css/main.css` — Tokens nuevos (`--accent-*`, `--on-primary`, `--*-strong`), acento morado residual `rgba(108,99,255,…)`/`#a78bfa` reemplazado por el acento esmeralda en sidebar, focos, filas de tabla y badges; `.badge-*` unificados con tokens semánticos y contraste AA; bloque global `prefers-reduced-motion`.
- `public/css/styles-responsive.css` — Fallback de `--primary` corregido de `#6c63ff` a `#10b981`.

---

## Base de datos local (JSON)

### Problemática
Se necesitaba trabajar con una copia de la base de datos de MongoDB Atlas en local, sin modificar los datos de producción.

### Solución implementada

**Exportación de datos:**
- Script `scripts/export-db-to-json.js` que exporta todas las colecciones de Atlas a archivos JSON
- Los JSON se guardan en `db-export/`
- Los `_id` se convierten a string para compatibilidad

**Modo de ejecución (`.env`):**
```
DB_MODE=json    → Usa archivos JSON locales (en memoria con mongodb-memory-server)
DB_MODE=mongo   → Conecta a MongoDB Atlas (producción)
```

**Archivos modificados:**
- `config/database.js` — Detecta `DB_MODE` y carga datos desde JSON o conecta a Atlas
- `server.js` — Usa `connectDB()` en vez de `initDB()`
- `.env` — Variable `DB_MODE=json` activada por defecto

**Archivos creados:**
- `scripts/export-db-to-json.js` — Script de exportación
- `config/local/json-db.js` — Adaptador JSON (respaldo)
- `db-export/*.json` — 12 colecciones exportadas

---

## Corrección del flujo de dinero en Caja

### Problemática
La tarjeta **Transferencia** solo mostraba ingresos manuales, excluyendo pagos de membresía y ventas de productos pagados por transferencia.

### Causa
En `routes/caja.js`, las agregaciones de pagos y ventas filtraban solo `['efectivo', 'yape', 'plin']`, excluyendo `transferencia`.

### Corrección (`routes/caja.js`)

**Línea 40 — Agregación de pagos:**
```js
// Antes:
metodo_pago: { $in: ['efectivo', 'yape', 'plin'] }

// Después:
metodo_pago: { $in: ['efectivo', 'yape', 'plin', 'transferencia'] }
```

**Línea 46 — Agregación de ventas:**
```js
// Antes:
metodo_pago: { $in: ['efectivo', 'yape', 'plin'] }

// Después:
metodo_pago: { $in: ['efectivo', 'yape', 'plin', 'transferencia'] }
```

**Cálculo de `total_transferencia`:**
```js
// Antes:
total_transferencia: ingresosManTransferencia

// Después:
total_transferencia: totalTransPagos + totalTransVentas + ingresosManTransferencia
```

---

## Unificación del cálculo "Ventas del Turno"

### Problemática
La sección de caja abierta y el historial de cajas calculaban los ingresos del turno de forma diferente:
- **Caja abierta:** Llamaba a `GET /caja/:id/detalle` y sumaba pagos + ventas manualmente
- **Historial:** Usaba `ingresos_membresias + ingresos_ventas` (sin incluir ingresos manuales)

### Solución

**Backend** — Ambos endpoints ahora calculan `total_turno` con la misma fórmula:

```
total_turno = pagos + ventas + ingresosManuales - egresosManuales
```

| Endpoint | Archivo | Líneas |
|---|---|---|
| `GET /caja/estado` | `routes/caja.js` | 60-74 |
| `GET /caja` (historial) | `routes/caja.js` | 105-116 |

**Frontend** — `caja.html`:
- Caja abierta: Usa `caja.total_turno` directamente (eliminó llamado a `/:id/detalle`)
- Historial: Usa `c.total_turno` en vez de `ingresos_membresias + ingresos_ventas`

### Fórmula del "Total en Caja"

```
Total en Caja = monto_inicial + total_turno
```

Donde `total_turno` incluye: pagos de membresía + ventas de productos + ingresos manuales - egresos manuales (todos los métodos de pago).

---

## Notas técnicas

- `mongodb-memory-server` crea una instancia MongoDB en memoria, cargando los JSON al iniciar
- Los datos en modo JSON se guardan en `db-export/*.json` y se modifican localmente
- Para refrescar datos desde Atlas: `node scripts/export-db-to-json.js`
- Para volver a Atlas: comentar `DB_MODE=json` en `.env`
