# Arquitectura del Proyecto - PeruGym

## 1. Descripción General

PeruGym es un sistema de gestión integral para gimnasios desarrollado con Node.js, Express y MongoDB. El proyecto está desplegado en Netlify como una aplicación serverless con un frontend SPA (Single Page Application) y una API REST.

## 2. Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| **Backend** | Node.js + Express.js |
| **Base de Datos** | MongoDB con Mongoose (modo Atlas) / JSON local (modo desarrollo) |
| **Autenticación** | JWT (JSON Web Tokens) con renovación deslizante |
| **Almacenamiento** | Cloudinary (con fallback local) |
| **Testing** | Jest + Supertest + MongoDB Memory Server |
| **Reportes** | ExcelJS + PDFKit |
| **IA** | Groq API (compatible con OpenAI) |
| **Frontend** | HTML + CSS + JavaScript vanilla (SPA) |
| **3D** | Three.js (visor de mancuerna en login) |
| **Despliegue** | Netlify Functions (serverless) |

## 3. Arquitectura de Despliegue (Netlify)

```
┌─────────────────────────────────────────────────────────────┐
│                        NETLIFY                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌──────────────────────────────────┐   │
│  │   Static    │    │         Functions                │   │
│  │   Site      │    │  ┌────────────────────────────┐  │   │
│  │             │    │  │  api.js (Express app)      │  │   │
│  │  public/    │    │  │  → /api/*                  │  │   │
│  │  (HTML,CSS, │    │  └────────────────────────────┘  │   │
│  │   JS)       │    │  ┌────────────────────────────┐  │   │
│  │             │    │  │  vencer-membresias.js      │  │   │
│  │             │    │  │  → Cron job diario 2am     │  │   │
│  │             │    │  └────────────────────────────┘  │   │
│  └─────────────┘    └──────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Configuración de Netlify (`netlify.toml`)

- **Build**: `publish = "public"`, `functions = "netlify/functions"`
- **Redirects**: `/api/*` → `/.netlify/functions/api/:splat` (SPA fallback)
- **Headers**: Cache-Control para assets estáticos (imágenes immutable, HTML no-store)
- **Scheduled Function**: `vencer-membresias` corre diariamente a las 2am UTC

## 4. Estructura del Proyecto

```
SisPeruGym/
├── config/                    # Configuraciones
│   ├── database.js            # Conexión MongoDB / JSON local
│   ├── cloudinary.js          # Configuración Cloudinary
│   ├── storage.js             # Helper de almacenamiento (Cloudinary/local)
│   └── local/json-db.js       # Adaptador JSON (respaldo)
├── middleware/                # Middlewares Express
│   ├── auth.js                # JWT, roles, protectDeveloperUser
│   ├── cajaAbierta.js         # Verifica caja abierta
│   ├── errorHandler.js        # Manejo centralizado de errores
│   ├── validation.js          # Validadores reutilizables
│   └── errors/ErrorTypes.js   # Clases de error personalizadas
├── models/                    # Modelos Mongoose
│   ├── Usuario.js
│   ├── Cliente.js
│   ├── Plan.js
│   ├── Membresia.js
│   ├── Pago.js
│   ├── Caja.js
│   ├── MovimientoCaja.js
│   ├── Producto.js
│   ├── Venta.js
│   ├── Asistencia.js
│   ├── Solicitud.js
│   └── LandingConfig.js
├── routes/                    # Rutas de la API
│   ├── auth.js                # Login, logout, refresh, usuarios
│   ├── clientes.js            # CRUD clientes + RENIEC
│   ├── membresias.js          # Suscripción, renovación, cambio plan
│   ├── caja.js                # Apertura/cierre, movimientos
│   ├── ventas.js              # Ventas con control de stock
│   ├── pagos.js               # Pagos y abonos
│   ├── asistencia.js          # Check-in/check-out
│   ├── productos.js           # CRUD productos
│   ├── planes.js              # CRUD planes
│   ├── solicitudes.js         # Leads desde landing
│   ├── dashboard.js           # Métricas y estadísticas
│   ├── reports.js             # Exportación Excel/PDF
│   ├── landing.js             # Configuración landing
│   ├── agente.js              # Chat con IA (Groq)
│   └── health.js              # Health check
├── services/                  # Lógica de negocio
│   ├── StockService.js        # Control atómico de inventario
│   ├── MembresiaService.js    # Ciclo de vida de membresías
│   ├── CajaService.js         # Operaciones de caja
│   └── AgenteService.js       # Integración con Groq IA
├── functions/                 # Netlify Functions
│   ├── api.js                 # Handler serverless (Express)
│   └── vencer-membresias.js    # Cron job programado
├── utils/                     # Utilidades
│   ├── TransactionManager.js  # Transacciones MongoDB con rollback
│   └── logger.js              # Logging estructurado JSON
├── public/                    # Frontend SPA
│   ├── app.html               # Shell SPA (sidebar + router)
│   ├── index.html             # Landing page pública
│   ├── login.html             # Login con visor 3D
│   ├── dashboard.html         # Panel principal
│   ├── clientes.html          # Gestión de clientes
│   ├── membresias.html        # Gestión de membresías
│   ├── caja.html              # Control de caja
│   ├── ventas.html            # Punto de venta
│   ├── pagos.html             # Gestión de pagos
│   ├── asistencia.html        # Control de asistencia
│   ├── productos.html         # Gestión de productos
│   ├── planes.html            # Gestión de planes
│   ├── solicitudes.html       # Leads
│   ├── reports.html           # Reportes
│   ├── users.html             # Gestión de usuarios
│   ├── landing-admin.html     # Configuración landing
│   ├── css/                   # Estilos
│   │   ├── main.css           # Sistema de diseño (tokens)
│   │   ├── styles-responsive.css
│   │   ├── landing.css
│   │   └── agent-widget.css
│   └── js/                    # JavaScript frontend
│       ├── router.js          # SPA Router (navegación sin recarga)
│       ├── api.js             # Cliente HTTP con caché
│       ├── cache.js           # Sistema de caché (sessionStorage)
│       ├── layout.js          # Sidebar, topbar, panel notificaciones
│       ├── utils.js           # Utilidades (toast, modales, etc.)
│       ├── icons.js           # Iconos SVG
│       ├── app-responsive.js  # Responsive sidebar
│       └── agent-widget.js    # Widget de chat IA
├── tests/                     # Tests
│   ├── unit/                  # Tests unitarios
│   ├── concurrency/            # Tests de concurrencia
│   ├── regression/            # Tests de regresión
│   └── helpers/               # Setup y factories
├── scripts/                   # Scripts de migración
│   ├── migrations/            # Migraciones de BD
│   ├── export-db-to-json.js   # Exportar Atlas → JSON
│   └── sync-from-atlas.js     # Sincronizar desde Atlas
├── docs/                      # Documentación
├── db-export/                 # Datos JSON locales
└── netlify.toml               # Configuración de despliegue
```

## 5. Arquitectura del Frontend (SPA)

### 5.1. Shell SPA (`app.html`)

El frontend es una SPA que carga el sidebar una sola vez y luego inyecta el contenido de cada gestión sin recargar la página:

```
┌─────────────────────────────────────────────────────────────┐
│                      app.html (Shell)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐  ┌────────────────────────────────────────┐ │
│  │            │  │  Topbar                                │ │
│  │  Sidebar   │  ├────────────────────────────────────────┤ │
│  │  (fijo)    │  │                                        │ │
│  │            │  │  #spa-content                          │ │
│  │  - Dash    │  │  (se reemplaza al navegar)             │ │
│  │  - Clientes│  │                                        │ │
│  │  - Memb.   │  │  Contenido de cada página se inyecta   │ │
│  │  - Caja    │  │  aquí via fetch + DOMParser            │ │
│  │  - ...     │  │                                        │ │
│  │            │  │                                        │ │
│  └────────────┘  └────────────────────────────────────────┘ │
│                                                              │
│  Scripts base (cargados UNA SOLA VEZ):                       │
│  cache.js → api.js → utils.js → icons.js → layout.js →       │
│  app-responsive.js → router.js → agent-widget.js             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2. Flujo de Navegación

1. Usuario hace click en el sidebar
2. `router.js` intercepta el click
3. Fetch de la página HTML con header `X-SPA-Request: 1`
4. Se parsea el HTML (extrae contenido, scripts, modales)
5. Se inyecta en `#spa-content`
6. Se ejecutan los scripts inline (envueltos en IIFE)
7. Se actualiza el estado (URL, sidebar activo, título)

### 5.3. Sistema de Caché (`cache.js`)

- **Almacenamiento**: `sessionStorage` (persiste durante la sesión del navegador)
- **TTL configurable** por namespace (1-10 minutos según la entidad)
- **Invalidación**: quirúrgica (patch de ítems) o por namespace
- **Eventos**: `gym-cache-invalidated` para sincronización entre componentes

### 5.4. API Client (`api.js`)

- **Base URL**: `/api`
- **Headers**: Authorization Bearer token automático
- **Manejo de errores**: 401 → logout automático, 403 → error de permisos
- **Caché**: GET con caché, POST/PUT/DELETE con invalidación automática
- **Descarga de archivos**: Método `download()` para reportes Excel/PDF

## 6. Arquitectura del Backend

### 6.1. Flujo de una Petición

```
Cliente (Navegador)
    │
    ▼
Netlify Function (api.js)
    │
    ▼
Express App
    │
    ├── Helmet (headers seguridad)
    ├── CORS
    ├── Body Parser (JSON, urlencoded, fileupload)
    ├── Rate Limit (login)
    ├── verifyToken (JWT)
    ├── requireRole (autorización)
    ├── Validación (express-validator)
    │
    ▼
Route Handler
    │
    ├── Service (lógica de negocio)
    │   └── TransactionManager (transacciones)
    │       └── StockService / MembresiaService / CajaService
    │
    ▼
Mongoose Model
    │
    ▼
MongoDB Atlas
```

### 6.2. Manejo de Errores

- **ErrorTypes.js**: Clases de error personalizadas (BusinessError, NotFoundError, etc.)
- **errorHandler.js**: Middleware centralizado que captura y formatea errores
- **asyncHandler.js**: Wrapper para capturar errores async automáticamente
- **Respuestas consistentes**: `{ error: "mensaje" }` con código HTTP apropiado

### 6.3. Seguridad

- **Autenticación**: JWT con expiración configurable (7 días por defecto)
- **Renovación deslizante**: `POST /api/auth/refresh` extiende la sesión
- **Rate limiting**: Login limitado por IP (30/15min) y por cuenta (10/15min)
- **Helmet**: Headers HTTP de seguridad (CSP, HSTS, etc.)
- **CORS**: Configurable por `ALLOWED_ORIGINS`
- **Validación**: express-validator en todas las rutas
- **Sanitización**: Regex escape para búsquedas, normalización de emails
- **Protección de usuario dev**: No puede ser modificado/eliminado

## 7. Base de Datos

### 7.1. Modelos Principales

| Modelo | Descripción | Índices clave |
|--------|-------------|---------------|
| `Usuario` | Usuarios del sistema | usuario (unique), email (unique) |
| `Cliente` | Clientes del gimnasio | nombre+apellidos (text), dni (sparse) |
| `Plan` | Planes de membresía | - |
| `Membresia` | Membresías activas/vencidas | cliente_id+estado (unique parcial), fecha_fin+estado |
| `Pago` | Registro de pagos | caja_id+estado, membresia_id |
| `Caja` | Control de caja diaria | estado (unique parcial: solo abierta) |
| `MovimientoCaja` | Ingresos/egresos manuales | caja_id+tipo |
| `Producto` | Productos para venta | nombre (text) |
| `Venta` | Ventas realizadas | caja_id+fecha_venta+anulada |
| `Asistencia` | Registro de asistencias | cliente_id+salida, fecha |
| `Solicitud` | Leads desde landing | estado, created_at |
| `LandingConfig` | Configuración landing | singleton |

### 7.2. Modos de Conexión

- **`DB_MODE=mongo`**: Conecta a MongoDB Atlas (producción)
- **`DB_MODE=json`**: Usa archivos JSON locales en `db-export/` con `mongodb-memory-server` (desarrollo)

### 7.3. Transacciones

El `TransactionManager` proporciona un wrapper para transacciones MongoDB con:
- Rollback automático en caso de error
- Log de duración (warn si > 2 segundos)
- Opción de desactivar con `DISABLE_TRANSACTIONS=true`

## 8. Servicios de Negocio

### 8.1. StockService

- **Descuento atómico**: `findOneAndUpdate` con condición `stock >= cantidad`
- **Reversión**: Incremento de stock para anulaciones
- **Múltiples items**: Descuento/reversión en lote

### 8.2. MembresiaService

- **Auto-vencimiento**: Marca membresías vencidas (idempotent)
- **Creación**: Validación de membresía activa existente
- **Cambio de plan**: Cancela actual + crea nueva
- **Renovación**: Crea nueva membresía con mismo plan

### 8.3. CajaService

- **Apertura**: Verifica que no haya caja abierta
- **Cierre**: Calcula totales (pagos + ventas + movimientos)
- **Movimientos**: Validaciones de tipo, monto, concepto

### 8.4. AgenteService (IA)

- **Integración**: Groq API (compatible con OpenAI)
- **Function calling**: 30+ funciones (lectura, preview, escritura)
- **Historial**: En memoria por usuario (máximo 15 mensajes)
- **Confirmación**: Las operaciones de escritura requieren confirmación del usuario

## 9. Testing

### 9.1. Configuración

- **Framework**: Jest 30
- **Base de datos**: MongoDB Memory Server (réplica set para transacciones)
- **Cobertura mínima**: 70% (branches, functions, lines, statements)

### 9.2. Tipos de Tests

| Tipo | Descripción | Ejemplo |
|------|-------------|---------|
| **Unitarios** | Servicios y middlewares de forma aislada | `StockService.test.js` |
| **Concurrencia** | Race conditions en stock, membresías, caja | `stock-race-condition.test.js` |
| **Regresión** | Bugs específicos que no deben volver | `client-fullname-display-bug.test.js` |
| **Integración** | Flujos completos con Supertest | - |

### 9.3. Ejecución

```bash
npm test                    # Todos los tests
npm run test:unit          # Solo unitarios
npm run test:concurrency   # Solo concurrencia
npm run test:coverage      # Con reporte de cobertura
```

## 10. Despliegue

### 10.1. Netlify

El proyecto está configurado para despliegue automático en Netlify:

1. **Build**: `public/` (frontend estático) + `netlify/functions/` (backend serverless)
2. **Deploy**: Automático al push en la rama principal
3. **Dominio**: Configurado en el panel de Netlify

### 10.2. Variables de Entorno

Las variables se configuran en el panel de Netlify (Settings → Environment):

```
MONGO_URI=mongodb+srv://...
JWT_SECRET=...
JWT_EXPIRES_IN=7d
CLOUDINARY_ENABLED=true
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
RENIEC_API_URL=...
RENIEC_API_TOKEN=...
DEV_USERNAME=dev
DEV_EMAIL=dev@gym.com
DEV_PASSWORD_HASH=...
GROQ_API_KEY=...
DB_MODE=mongo
```

### 10.3. Migraciones

```bash
# Ejecutar migraciones (índices)
node scripts/migrations/001_add_indexes.js

# Rollback
node scripts/migrations/001_add_indexes.js rollback
```

## 11. Monitoreo

### 11.1. Health Check

```
GET /api/health
```

Devuelve estado de MongoDB, memoria y uptime.

### 11.2. Logs Estructurados

Todos los logs siguen formato JSON con timestamp, nivel, mensaje y contexto.

### 11.3. Alertas Recomendadas

- Health check cada 30 segundos
- Transacciones lentas (> 2s)
- Errores de integraciones externas (RENIEC, Cloudinary)
- Uso de memoria > 80%

## 12. Integraciones Externas

| Integración | Uso | Configuración |
|-------------|-----|---------------|
| **MongoDB Atlas** | Base de datos principal | `MONGO_URI` |
| **Cloudinary** | Almacenamiento de imágenes | `CLOUDINARY_*` |
| **RENIEC** | Consulta de DNI | `RENIEC_API_*` |
| **Groq** | Agente IA | `GROQ_API_KEY` |

## 13. Consideraciones de Seguridad

- [x] Autenticación JWT con expiración
- [x] Rate limiting en login
- [x] Validación de entrada en todas las rutas
- [x] Sanitización de logs (password, token redacted)
- [x] Headers de seguridad (Helmet)
- [x] CORS configurable
- [x] Protección contra NoSQL injection (regex escape)
- [x] Honeypot anti-bot en formulario de landing
- [x] Confirmación para operaciones de escritura del agente IA
- [x] Cierre de sesión por inactividad (60 min)

## 14. Próximos Pasos

- [ ] Implementar tests de integración con Supertest
- [ ] Agregar CI/CD con GitHub Actions
- [ ] Implementar paginación cursor-based para grandes volúmenes
- [ ] Agregar notificaciones push (Web Push API)
- [ ] Implementar exportación PDF de reportes
- [ ] Agregar modo offline con Service Workers
- [ ] Implementar auditoría de acciones sensibles
