# PeruGym - Registro de Cambios

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
