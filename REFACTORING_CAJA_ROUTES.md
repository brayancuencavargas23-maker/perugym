# Refactorización de routes/caja.js

## Resumen
Se refactorizó el archivo `routes/caja.js` para usar `CajaService` y `TransactionManager`, mejorando la separación de responsabilidades y el manejo de errores.

## Cambios Realizados

### 1. Imports Agregados
```javascript
const CajaService = require('../services/CajaService');
const TransactionManager = require('../utils/TransactionManager');
```

### 2. Ruta POST /abrir
**Antes:**
```javascript
router.post('/abrir', async (req, res) => {
  const { monto_inicial, notas } = req.body;
  try {
    const abierta = await Caja.findOne({ estado: 'abierta' });
    if (abierta) return res.status(400).json({ error: 'Ya hay una caja abierta' });
    const caja = await Caja.create({ usuario_id: req.user.id, monto_inicial: monto_inicial || 0, notas: notas || null });
    res.status(201).json(caja);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

**Después:**
```javascript
router.post('/abrir', asyncHandler(async (req, res) => {
  const { monto_inicial, notas } = req.body;
  
  const caja = await CajaService.abrir({
    usuario_id: req.user.id,
    monto_inicial,
    notas
  });
  
  res.status(201).json(caja);
}));
```

**Beneficios:**
- Usa `asyncHandler` para manejo automático de errores
- Delega la lógica de negocio al servicio
- Código más limpio y conciso
- Los errores BusinessError se manejan automáticamente

### 3. Ruta PUT /cerrar/:id
**Antes:**
```javascript
router.put('/cerrar/:id', async (req, res) => {
  const { monto_final, notas } = req.body;
  try {
    const cajaId = req.params.id;
    const mongoose = require('mongoose');
    const oid = mongoose.Types.ObjectId.createFromHexString(cajaId);

    // Cálculos de ingresos (múltiples agregaciones)
    const ingresosMem = await Pago.aggregate([...]);
    const ingresosVentas = await Venta.aggregate([...]);
    const movs = await MovimientoCaja.aggregate([...]);
    
    const total_ingresos = (ingresosMem[0]?.total || 0) + (ingresosVentas[0]?.total || 0) + ingresosManuales - egresosManuales;

    const caja = await Caja.findOneAndUpdate(...);
    if (!caja) return res.status(404).json({ error: 'Caja no encontrada o ya cerrada' });
    res.json(caja);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

**Después:**
```javascript
router.put('/cerrar/:id', asyncHandler(async (req, res) => {
  const { monto_final, notas } = req.body;
  
  const caja = await CajaService.cerrar(req.params.id, {
    monto_final,
    notas
  });
  
  res.json(caja);
}));
```

**Beneficios:**
- Elimina ~20 líneas de código complejo
- El servicio maneja el cálculo de totales
- Usa `asyncHandler` para manejo de errores
- NotFoundError se convierte automáticamente en 404

### 4. Ruta POST /:id/movimientos
**Antes:**
```javascript
router.post('/:id/movimientos', async (req, res) => {
  const { tipo, monto, concepto } = req.body;
  try {
    const caja = await Caja.findOne({ _id: req.params.id, estado: 'abierta' });
    if (!caja) return res.status(400).json({ error: 'La caja no está abierta' });
    if (!['ingreso', 'egreso'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    if (!monto || isNaN(monto) || parseFloat(monto) <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (!concepto || !concepto.trim()) return res.status(400).json({ error: 'El concepto es requerido' });

    const mov = await MovimientoCaja.create({
      caja_id: caja._id,
      usuario_id: req.user.id,
      tipo,
      monto: parseFloat(monto),
      concepto: concepto.trim(),
    });
    res.status(201).json({ ...mov.toObject(), id: mov._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

**Después:**
```javascript
router.post('/:id/movimientos', asyncHandler(async (req, res) => {
  const { tipo, monto, concepto } = req.body;
  
  const mov = await CajaService.registrarMovimiento(req.params.id, {
    usuario_id: req.user.id,
    tipo,
    monto,
    concepto
  });
  
  res.status(201).json({ ...mov.toObject(), id: mov._id });
}));
```

**Beneficios:**
- Elimina validaciones manuales (el servicio las maneja)
- Usa `asyncHandler` para manejo de errores
- Código más limpio y mantenible
- Validaciones centralizadas en el servicio

## Rutas NO Modificadas
Las siguientes rutas se mantuvieron sin cambios según los requisitos:
- `GET /estado` - Obtener estado de caja abierta
- `GET /` - Listar todas las cajas con paginación
- `GET /:id/detalle` - Obtener detalle de una caja
- `GET /:id/movimientos` - Listar movimientos de una caja
- `DELETE /:cajaId/movimientos/:movId` - Eliminar un movimiento

## Compatibilidad
✅ La estructura de respuesta JSON se mantiene idéntica para compatibilidad con el frontend
✅ Los códigos de estado HTTP se mantienen iguales
✅ Los mensajes de error son consistentes con el comportamiento anterior

## Manejo de Errores
El `errorHandler` middleware maneja automáticamente:
- `BusinessError` → 400 Bad Request
- `NotFoundError` → 404 Not Found
- Errores de validación de Mongoose → 400 Bad Request
- Errores no controlados → 500 Internal Server Error

## Verificación
✅ Sintaxis JavaScript válida (verificado con `node -c`)
✅ Imports correctos de CajaService y TransactionManager
✅ asyncHandler aplicado en las 3 rutas refactorizadas
✅ Estructura de respuesta mantenida para compatibilidad

## Próximos Pasos Recomendados
1. Probar manualmente las rutas refactorizadas en el entorno de desarrollo
2. Verificar que el frontend funciona correctamente con los cambios
3. Considerar refactorizar las rutas restantes (GET /estado, GET /, etc.) en el futuro
