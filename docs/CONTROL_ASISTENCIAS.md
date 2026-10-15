# Control de asistencia por plan

## Configurar Interdiario

1. En **Planes**, editar Interdiario y establecer **Máximo de visitas por semana = 3**.
2. Marcar **Aplicar también a membresías activas y pendientes** si el límite debe regir para los contratos actuales.
3. Guardar. La duración continúa siendo la cantidad de días configurada en el plan.

No se infiere el límite del nombre ni de la descripción. Un límite semanal vacío significa sin límite semanal; todos los planes permiten como máximo una visita diaria.

## Reglas

- Semana de lunes 00:00 a lunes 00:00, zona America/Lima (UTC-05).
- Cliente activo y membresía activa con `fecha_inicio <= ahora < fecha_fin`.
- Una entrada abierta, incluso de días anteriores, debe cerrarse antes de ingresar de nuevo.
- Cerrar una entrada no devuelve cupos. No se acumulan visitas entre semanas.
- Se cuenta todo el historial del cliente mediante `entrada`, incluidos registros antiguos y de otras membresías. Renovar o cambiar de plan no reinicia la semana.
- Tres visitas semanales no equivalen a un paquete de doce visitas mensuales. No se exigen días alternos ni días fijos.
- Las condiciones se copian a la membresía al suscribir, cambiar de plan o renovar. Editar el plan no cambia esa copia salvo que se marque la aplicación explícita.
- Contratos anteriores a esta funcionalidad: se copia su plan en la primera consulta de cupos o entrada. Si se edita el plan antes, se conserva primero la configuración anterior.

## Recepción

En **Asistencia**, seleccionar un cliente muestra plan, vigencia, visitas semanales y cupos disponibles. La consulta no usa caché. Al pulsar Check-in, el servidor vuelve a verificar las reglas; el texto mostrado no es una autorización permanente.

## Persistencia y concurrencia

Cada nueva asistencia contiene `membresia_id`, `dia_local`, `semana_local` y `cupo_semanal`. Dos índices únicos parciales protegen el día del cliente y el número de cupo de la semana. Los registros históricos sin estos campos se conservan y también se cuentan. No se requieren transacciones para estos índices, por lo que funcionan en MongoDB standalone y modo JSON local.

Mantener habilitada la creación de índices de Mongoose; no habilitar un despliegue sin estos índices. Los ingresos esperan `Asistencia.init()` antes de escribirse. No insertar asistencias nuevas desde rutas alternativas ni eliminar historial para liberar cupos.

Después de desplegar, reiniciar el proceso Node si no utiliza nodemon, recargar el navegador y configurar los límites de cada plan. No se modifican automáticamente los planes guardados en la base de datos.

## Pruebas

`npm test -- --runInBand tests/integration/asistencia-limites.test.js tests/unit/services/MembresiaService.test.js`

`node tests/helpers/asistencia-browser-smoke.js` comprueba los formularios de Planes y Asistencia en Chrome a 1440 y 375 px, con API simulada.

Las pruebas utilizan una base temporal y no modifican los clientes reales.
