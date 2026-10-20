# Acceso con correo y Google

El login acepta correo y contraseña. El nombre de usuario se conserva como nombre visible. Google permite entrar únicamente a cuentas `@gmail.com` verificadas, registradas en `usuarios` y activas. No registra usuarios automáticamente y no usa los permisos de Google como permisos de PeruGym.

## Configuración

Crear en Google Cloud Console un cliente OAuth de tipo **Aplicación web**. Registrar las URI de redirección autorizadas exactamente:

- Local: `http://localhost:3000/api/auth/google/callback`
- Producción: `https://TU-DOMINIO/api/auth/google/callback`

Configurar en `.env` local y en las variables de entorno de Netlify:

```dotenv
GOOGLE_CLIENT_ID=tu-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu-secreto
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
JWT_EXPIRES_IN=12h
```

En Netlify, `GOOGLE_CALLBACK_URL` debe ser la URL **HTTPS del sitio publicado**, no localhost. Las tres variables Google y `JWT_SECRET` deben estar disponibles para las Functions. Reiniciar Node después de editar `.env`; volver a desplegar en Netlify después de configurar las variables.

Configurar la pantalla de consentimiento de Google. Si está en modo de prueba, añadir las cuentas permitidas como usuarios de prueba. También deben estar registradas y activas en PeruGym. Corregir cualquier correo incorrecto en el panel de usuarios tras confirmar el correo real con su dueño.

## Base de datos y arranque

`DB_MODE=mongo` consulta la base indicada en `MONGO_URI`; `DB_MODE=json` carga otra copia de los usuarios desde `db-export/usuarios.json`. Un correo corregido en Atlas no se actualiza automáticamente en la copia JSON. Reiniciar Node después de cambiar el modo.

El arranque local ya no crea automáticamente la cuenta `admin@gym.com`. Si el administrador existente cambió de correo, intentar recrear el nombre `admin` causaba un conflicto de índice único y detenía el servidor. Las cuentas existentes conservan sus correos, contraseñas y permisos.

## Flujo

1. El botón abre `/api/auth/google` y redirige a Google.
2. El servidor guarda un estado firmado y temporal en cookie HttpOnly. Usa `state`, `nonce` y PKCE.
3. El callback valida el estado, intercambia el código con el secreto y verifica firma, audiencia, expiración y nonce del ID token.
4. Tras comprobar el usuario activo, entrega un resultado temporal HttpOnly; la página de login lo recoge por POST. El JWT de sesión y los tokens de Google nunca aparecen en la URL.
5. La sesión de PeruGym sigue usando el almacenamiento actual del proyecto (`localStorage`) y su renovación existente. Google facilita volver a autenticarse, pero no elimina el riesgo de XSS ni añade revocación de JWT. El logout actual borra el token del navegador; no invalida copias robadas. Una futura migración a sesiones revocables con cookies HttpOnly permitiría reforzar esto.

El valor predeterminado para nuevos tokens es 12 horas. Un `JWT_EXPIRES_IN` explícito en el entorno lo reemplaza. Los tokens emitidos anteriormente mantienen su expiración original; este cambio no los revoca.

Las protecciones de intentos del router de autenticación también se ejecutan en Netlify. El limitador en memoria es por instancia: no es un límite distribuido entre Functions. Para un límite global se necesita almacenamiento compartido o protección del proveedor.

El flujo usa redirecciones del servidor, por lo que no necesita un script de Google en el navegador ni ampliar la CSP para Google. El usuario desarrollador del `.env` entra por su `DEV_EMAIL` y contraseña; Google se reserva a usuarios registrados en la base de datos.

## Diagnóstico en Netlify

Si `/api/auth/google` devuelve `google_error=config`, consultar los logs de la Function `api` y buscar `google_oauth_start_failed`. El registro muestra la presencia de las cuatro variables, la versión de Node y la etapa del fallo, sin mostrar valores privados:

- `GOOGLE_CONFIG_MISSING`: falta una variable o está vacía en la Function que ejecutó la petición.
- `GOOGLE_CALLBACK_INVALID`: la URL de retorno no es válida o usa HTTP fuera de localhost.
- `OAUTH_START_ERROR`: consultar `stage` para distinguir generación de estado, cookie, URL de autorización o redirección. No implica necesariamente que falten variables.

Después de publicar esta versión de diagnóstico, provocar una petición al botón Google y consultar el evento más reciente. Guardar variables en el panel no actualiza Functions ya desplegadas: realizar un nuevo deploy publicado.
