# Reportes y análisis

## Uso

Abrir **Reportes**, seleccionar fechas y pulsar **Actualizar**. Los períodos admiten hasta 366 días. La comparación utiliza el mismo número de días inmediatamente anterior. Las tarjetas abren su detalle; las tablas incluyen búsqueda y paginación de 15 filas.

El análisis se exporta a Excel con varias hojas. **Imprimir / PDF** usa el diálogo de impresión del navegador (la tabla visible conserva su página y filtros). Las exportaciones operativas completas continúan disponibles al pie de la página.

## Definiciones

- **Cobrado:** pagos confirmados + ventas no anuladas + ingresos manuales (rutinas y otros). Los egresos se muestran por separado; no se presenta utilidad.
- **Fechas:** límites de días de Lima, inicio incluido y comienzo del día siguiente excluido. Los porcentajes sin denominador se muestran como “Sin base”.
- **Vigentes:** personas únicas con membresía activa y fechas que incluyen el momento de actualización.
- **Nuevos clientes de pago:** primer pago confirmado asociado a una membresía en el período.
- **Altas / posteriores:** inicios de membresías no pendientes ni canceladas; las posteriores incluyen renovaciones y reactivaciones. No equivalen a nuevos clientes de pago.
- **Renovación:** último vencimiento elegible por cliente dentro del período, con ventana de 7 días ya finalizada al momento de consulta. Se considera renovado si una membresía posterior no pendiente ni cancelada comienza dentro de esos 7 días.
- **Saldos actuales:** importe acordado menos pagos confirmados por membresía no cancelada. Para registros antiguos sin importe acordado, se usa `total_esperado` o el total registrado de pagos; nunca el precio actual del plan. Pagos sin membresía asociada no forman parte de este indicador.
- **Inasistencia:** membresía vigente sin visitas por 7, 14 o 30 días desde la última visita o el inicio de la membresía, el más reciente. No es una predicción de abandono.
- **Stock estimado:** stock actual dividido entre unidades vendidas por día del período. Sin ventas no se estima cobertura. Se recomienda revisar stock agotado o cobertura de hasta 7 días.
- **Afluencia:** entradas por día de semana y hora local, no ocupación simultánea.

Vigentes, saldos, stock y recomendaciones son **actuales**; ingresos, asistencia, ventas y contrataciones corresponden al **período**. El sistema no dispone de un historial completo de cambios de estado para reconstruir todas las métricas a una fecha pasada.

## Seguimiento

Las recomendaciones permiten abrir WhatsApp, Pagos o Membresías. El estado se guarda en `ReporteSeguimiento` con responsable y fecha: pendiente, contactado o resuelto. No se envían mensajes automáticamente. Resolver un seguimiento no cancela la deuda ni modifica la membresía.

Las alertas de vencimiento y saldo se identifican por membresía; las de inasistencia incluyen la fecha de última visita/inicio, para que una nueva ausencia pueda generar un seguimiento distinto. El historial visible corresponde a señales que continúan presentes.

## API y mantenimiento

- `GET /api/reports/analytics?from=AAAA-MM-DD&to=AAAA-MM-DD&inactiveDays=14`
- `GET /api/reports/analytics/excel` con los mismos parámetros.
- `PUT /api/reports/seguimiento` con `{ clave, estado }`.
- Acceso: admin y recepcionista, igual que las exportaciones existentes.
- `services/ReportesService.js` comparte los cálculos de pantalla y Excel.
- `utils/reportDates.js` centraliza las fechas de Lima.
- Chart.js se carga bajo demanda; las tablas siguen disponibles si falla su descarga.
- No se requiere servicio de IA: las sugerencias son reglas explicables.

## Verificación

```sh
npm test -- --runInBand tests/integration/reports-analytics.test.js
node tests/helpers/reports-browser-smoke.js
```

La prueba de navegador usa Chrome headless y datos simulados para comprobar interfaz e interacciones a 1440 y 375 píxeles. Se puede definir `CHROME_PATH`. Las pruebas de integración usan MongoDB temporal, sin consultar datos del gimnasio.
