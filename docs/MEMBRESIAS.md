# Membresías y renovaciones

Actualizado: 2026-10-11.

## Reglas acordadas

- Renovar conserva el identificador de la membresía. Cada compra añade un periodo.
- Si la membresía está vencida, el inicio predeterminado es hoy a medianoche de Lima.
  Recepción puede elegir hoy o una fecha posterior; no se retrocede al vencimiento anterior.
- Si aún tiene días, el nuevo periodo comienza exactamente en el vencimiento actual.
  El plan y las condiciones anteriores siguen vigentes hasta ese instante.
- Se puede elegir otro plan activo y un precio acordado para el nuevo periodo.
- La interfaz propone el precio vigente del catálogo, sin arrastrar descuentos anteriores.
  El botón «Usar precio sin descuento» restablece ese valor.
- Debe liquidarse toda deuda anterior del cliente antes de renovar o suscribir otro contrato.
  Un sobrepago de un periodo no cubre automáticamente otro periodo.
- Se admite pago completo, primer abono o cargo pendiente para el nuevo periodo.
- Un abono habilita el periodo, aunque quede saldo. Sin abono, el periodo pendiente no habilita acceso.
- Un periodo futuro pendiente no quita acceso a otro periodo actual habilitado.
- Se admite una renovación futura programada por membresía. Para otra, debe comenzar la anterior.
- Renovar no reinicia las visitas diarias ni semanales del cliente.
- Una membresía cancelada requiere otra suscripción; cancelar no elimina su deuda registrada.
- Los intervalos de acceso son `[fecha_inicio, fecha_fin)`, conservando las fechas existentes.

## Datos

`Membresia.periodos` es un historial embebido con identificador por periodo:

- Plan, nombre contratado, fechas y duración.
- Precio de catálogo al contratar, descuento y precio acordado.
- Condiciones de asistencia y habilitación del periodo.
- Usuario de la renovación, notas y fecha de registro.

`Membresia.monto_total` contiene la suma contractual de los periodos. No representa
el precio del periodo actual. Las respuestas de consulta exponen `precio`,
`total_pagado`, `saldo_total`, `periodo_actual_id`, `proxima_renovacion` y `version`.

`Pago.periodo_id` identifica a qué periodo se aplica el dinero; `Asistencia.periodo_id`
registra el periodo usado por cada nueva visita. Los pagos anteriores
sin ese campo corresponden exclusivamente al periodo inicial, nunca a una renovación.
Pagos muestra grupos por membresía y periodo, con su importe y fechas propios.

Los campos superiores de plan/estado/condiciones se sincronizan al periodo aplicable.
Asistencia resuelve el periodo por la fecha de la visita, sin depender de que haya
corrido una tarea programada. Reportes usa los periodos para altas y renovaciones,
deudas y seguimiento; caja y exportaciones de pagos usan el nombre contratado.

## Compatibilidad con datos existentes

En la primera renovación, la membresía anterior se convierte en su periodo inicial
y se conserva su ID, fechas, monto y pagos. No se fusionan automáticamente otros
registros antiguos del mismo cliente ni se reescriben sus referencias.

Los contratos nuevos guardan precio de catálogo y nombre al suscribir. Si un contrato
antiguo no tenía precio original, ese precio se mantiene desconocido (`null`), sin
inventarlo a partir del catálogo vigente. Para montos contractuales antiguos ausentes
se usa `total_esperado` de los pagos o, en su ausencia, el importe registrado.

Los periodos y sus referencias/fechas también se hidratan al importar el modo JSON.
No hace falta ejecutar una migración para empezar a renovar con este modelo.

La edición manual de estado/fecha se rechaza para contratos con periodos; se usa
Renovar para agregar vigencia o Cancelar para cancelar el contrato. El antiguo endpoint
de cambio inmediato de plan se conserva solo para contratos sin periodos y no aparece
como acción principal en la tabla.

## API

`POST /api/membresias/:id/renovar` responde 200:

```json
{
  "version": 0,
  "plan_id": "ID_MONGODB_DEL_PLAN",
  "precio_acordado": 100,
  "fecha_inicio": "2026-10-11",
  "estado_pago": "pagado",
  "monto": 50,
  "metodo_pago": "efectivo",
  "caja_id": "ID_MONGODB_DE_LA_CAJA",
  "notas": "Primer abono del nuevo periodo"
}
```

`version`, `plan_id`, `precio_acordado` y caja abierta son necesarios. Si no se
envía `monto` se cobra completo; `estado_pago: pendiente` registra el cargo sin cobro.
Para renovación anticipada se omite `fecha_inicio` o se envía el instante exacto
del vencimiento actual, no una fecha que quite días.

- `GET /api/membresias/:id/detalle`: información actual e historial.
- `GET /api/membresias/:id/periodos`: periodos y saldo total.
- `GET /api/membresias/:id/pagos?periodo_id=...`: pagos de un periodo.
- `GET /api/pagos/:membresia_id/estado-pago?periodo_id=...`: saldo de un periodo.
  Sin filtro elige el primer periodo con saldo, o el actual si no hay deuda.
- `POST /api/pagos/abono`: acepta `periodo_id`; sin él aplica al primer saldo pendiente.
- `PUT /api/pagos/:id/confirmar`: confirma una sola vez el saldo registrado del cargo.

Al abonar un cargo pendiente se reduce ese cargo al saldo real; al completarlo
se retira el cargo pendiente y se conservan los pagos efectivamente cobrados.

Renovación, abonos y confirmación usan sesión transaccional y una escritura condicional
de versión. Los formularios obsoletos reciben 409. Se escribe también la caja abierta
en la sesión para competir con su cierre. Con transacciones desactivadas se conserva
la exclusión por versión, pero no existe rollback general ante fallos parciales.

## Verificación focalizada

```sh
npm test -- --runInBand --coverage=false --silent tests/integration/membresias-renovacion.test.js tests/integration/membresias-periodos.test.js tests/concurrency/membresia-renovacion.test.js
node tests/helpers/membresias-browser-smoke.js
```

Las pruebas de integración y concurrencia usan bases temporales. El smoke ejecuta
HTML/JS reales de membresías y pagos en Chrome, con API simulada, a 1440 y 375 px,
en temas claro y oscuro. Verificación realizada: 89 pruebas aprobadas en 10 suites
(incluye regresiones de asistencia, reportes, caja/dashboard y asistente), y los
8 escenarios de navegador aprobados. Se ejecutó Jest con `--coverage=false`.

## Referencias consultadas para el diseño

- [Gymdesk: configuración de membresías](https://docs.gymdesk.com/en/help/docs/membership-options).
- [Gymdesk: pagos y cargos del miembro](https://docs.gymdesk.com/en/help/docs/member-payments).
- [wger: modelo público de contratos](https://github.com/wger-project/wger/blob/master/wger/gym/models/contract.py).
- [Stripe: cambio de precio y ciclo de suscripción](https://docs.stripe.com/billing/subscriptions/change-price).

Se usaron como referencias de dominio, no como integraciones ni como código copiado.
