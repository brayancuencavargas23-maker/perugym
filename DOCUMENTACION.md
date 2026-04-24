# Peru Gym — Documentación del Sistema

## Índice
1. [Descripción general](#descripción-general)
2. [Stack tecnológico](#stack-tecnológico)
3. [Estructura de archivos](#estructura-de-archivos)
4. [Instalación y arranque](#instalación-y-arranque)
5. [Variables de entorno](#variables-de-entorno)
6. [Base de datos](#base-de-datos)
7. [Autenticación y roles](#autenticación-y-roles)
8. [Módulos del sistema](#módulos-del-sistema)
9. [API REST — Endpoints](#api-rest--endpoints)
10. [Almacenamiento de imágenes](#almacenamiento-de-imágenes)
11. [Despliegue en Netlify](#despliegue-en-netlify)

---

## Descripción general

**Peru Gym** es un sistema web completo de gestión para gimnasios. Incluye una landing page pública y un panel de administración privado con los siguientes módulos: miembros, planes, pagos, asistencia, entrenadores, clases, productos, caja y reportes.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Base de datos | PostgreSQL (driver `pg`) |
| Frontend | HTML + CSS + JavaScript vanilla |
| Autenticación | JWT (jsonwebtoken + bcryptjs) |
| Imágenes | Local (`public/imagenes/`) o Cloudinary |
| Subida de archivos | express-fileupload |
| Reportes | ExcelJS + PDFKit |
| Despliegue | Netlify Functions + serverless-http |

---

## Estructura de archivos

```
PeruGym/
├── server.js                  # Entrada principal (desarrollo local)
├── package.json
├── .env                       # Variables de entorno (no subir a git)
├── .env.example               # Plantilla de variables
├── netlify.toml               # Configuración de Netlify
│
├── config/
│   ├── database.js            # Conexión PostgreSQL + inicialización de tablas
│   ├── storage.js             # Lógica de subida de imágenes (local o Cloudinary)
│   └── cloudinary.js          # Configuración legacy de Cloudinary
│
├── middleware/
│   └── auth.js                # Verificación JWT + control de roles
│
├── routes/
│   ├── auth.js                # Login + CRUD de usuarios del sistema
│   ├── members.js             # CRUD de miembros
│   ├── plans.js               # CRUD de planes/membresías
│   ├── payments.js            # Registro y consulta de pagos
│   ├── attendance.js          # Check-in / check-out
│   ├── trainers.js            # CRUD de entrenadores
│   ├── classes.js             # CRUD de clases grupales
│   ├── products.js            # CRUD de productos + ventas
│   ├── caja.js                # Apertura/cierre de caja + historial
│   ├── dashboard.js           # Estadísticas generales
│   └── reports.js             # Exportación Excel y PDF
│
├── netlify/functions/
│   └── api.js                 # Wrapper serverless para Netlify
│
└── public/                    # Frontend estático
    ├── index.html             # Landing page pública (Peru Gym)
    ├── login.html             # Formulario de login
    ├── dashboard.html
    ├── members.html
    ├── plans.html
    ├── payments.html
    ├── attendance.html
    ├── trainers.html
    ├── classes.html
    ├── products.html
    ├── caja.html
    ├── reports.html
    ├── users.html
    ├── css/
    │   ├── main.css           # Estilos del panel de administración
    │   └── landing.css        # Estilos de la landing page
    ├── js/
    │   ├── api.js             # Cliente HTTP (fetch wrapper con JWT)
    │   ├── utils.js           # Helpers: toast, paginación, fechas, etc.
    │   └── layout.js          # Sidebar + topbar dinámicos
    └── imagenes/
        ├── members/           # Fotos de miembros
        ├── trainers/          # Fotos de entrenadores
        ├── products/          # Fotos de productos
        └── index/             # Imágenes de la landing
```

---

## Instalación y arranque

### Requisitos previos
- Node.js 18+
- PostgreSQL 14+ corriendo localmente o en la nube

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# 3. Crear la base de datos en PostgreSQL
# (las tablas se crean automáticamente al arrancar)
psql -U postgres -c "CREATE DATABASE gym_db;"

# 4. Arrancar en desarrollo
npm run dev

# 5. Arrancar en producción
npm start
```

El servidor queda disponible en `http://localhost:3000`.

Al arrancar por primera vez se crea automáticamente el usuario administrador:
- **Email:** `admin@gym.com`
- **Contraseña:** `admin123`

---

## Variables de entorno

```env
# Base de datos
DATABASE_URL=postgresql://user:pass@host:5432/gym_db   # Para nube (Supabase, Railway, etc.)
DB_HOST=localhost       # Para local
DB_PORT=5432
DB_NAME=gym_db
DB_USER=postgres
DB_PASSWORD=tu_password

# JWT
JWT_SECRET=clave_secreta_larga_y_aleatoria
JWT_EXPIRES_IN=7d

# Cloudinary (opcional — si no se configura, las fotos se guardan localmente)
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

# Servidor
PORT=3000
NODE_ENV=development
```

---

## Base de datos

Las tablas se crean automáticamente al iniciar el servidor. El esquema es:

```
users           → Usuarios del sistema (admin, recepcionista, entrenador)
plans           → Planes de membresía
members         → Miembros del gimnasio
payments        → Pagos de membresías
attendance      → Registros de asistencia (check-in/check-out)
trainers        → Entrenadores
classes         → Clases grupales
products        → Productos del gimnasio (suplementos, ropa, etc.)
product_sales   → Ventas de productos
caja            → Turnos de caja (apertura/cierre)
```

### Relaciones principales

```
members     → plans         (plan_id)
payments    → members       (member_id)
payments    → plans         (plan_id)
attendance  → members       (member_id)
classes     → trainers      (trainer_id)
product_sales → products    (product_id)
product_sales → members     (member_id)
product_sales → caja        (caja_id)
caja        → users         (user_id)
```

---

## Autenticación y roles

El sistema usa **JWT** con expiración configurable (por defecto 7 días).

### Flujo de login
1. El usuario envía `POST /api/auth/login` con email y contraseña
2. El servidor valida las credenciales y devuelve un token JWT
3. El token se guarda en `localStorage` y se envía en cada request como `Authorization: Bearer <token>`
4. El middleware `auth.js` verifica el token en todas las rutas protegidas

### Roles disponibles

| Rol | Permisos |
|-----|---------|
| `admin` | Acceso total: CRUD en todos los módulos, gestión de usuarios |
| `recepcionista` | Puede registrar miembros, pagos, asistencia y ventas. No puede eliminar ni gestionar usuarios |
| `entrenador` | Puede ver miembros, registrar asistencia y gestionar clases propias |

---

## Módulos del sistema

### Landing Page (`/`)
Página pública de Peru Gym con:
- Navbar fijo con links de navegación
- Hero con imagen de fondo y watermark
- Barra de 4 características del gimnasio
- Sección "Sobre Nosotros" con estadísticas
- **Planes dinámicos** cargados desde la base de datos (solo los marcados como `show_in_landing = true`)
- Footer

### Login (`/login.html`)
Formulario de autenticación. Redirige al dashboard si ya hay sesión activa.

### Dashboard (`/dashboard.html`)
Vista general con:
- Miembros activos
- Ingresos del mes actual
- Asistencia del día
- Pagos pendientes
- Lista de membresías próximas a vencer (≤ 7 días)
- Gráfico de miembros por plan
- Últimos 5 pagos

### Miembros (`/members.html`)
CRUD completo con:
- Búsqueda por nombre o email
- Filtros por estado (activo/inactivo), plan y membresías por vencer
- Foto de perfil (guardada localmente o en Cloudinary)
- Paginación

### Planes (`/plans.html`)
CRUD de planes de membresía con:
- Nombre, precio, duración en días, descripción
- Lista de beneficios (uno por línea → aparecen con ✓ en la landing)
- Toggle "Mostrar en landing" y "Marcar como Más Popular"
- Botón "Ver landing" para previsualizar

### Pagos (`/payments.html`)
- Registro de pagos por miembro
- Filtros por estado (pagado/pendiente) y rango de fechas
- Autocompletado del monto al seleccionar un plan
- Historial paginado

### Asistencia (`/attendance.html`)
- Check-in rápido: selecciona miembro → botón Check-in
- Check-out por miembro o por registro individual
- Filtros por fecha o rango de fechas
- Muestra duración de cada visita

### Entrenadores (`/trainers.html`)
CRUD con:
- Foto de perfil
- Especialidades (separadas por coma)
- Estado activo/inactivo

### Clases (`/classes.html`)
CRUD de clases grupales con:
- Nombre, entrenador asignado, día de la semana
- Hora de inicio y fin, capacidad máxima
- Filtros por día y búsqueda por nombre

### Productos (`/products.html`)
Dos pestañas:
- **Productos:** CRUD con foto, categoría, precio y stock. Stock ≤ 5 se marca en rojo con ⚠️
- **Ventas:** Historial de ventas con filtros por fecha. Botón 🛒 en cada producto para venta rápida

### Caja (`/caja.html`)
Módulo de punto de venta:
- **Abrir caja:** registra monto inicial y cajero
- **Nueva venta:** selecciona producto y cantidad, asocia opcionalmente a un miembro. Descuenta stock automáticamente
- **Ventas del turno:** lista en tiempo real de ventas de la caja actual
- **Cerrar caja:** registra monto final contado
- **Historial:** todas las cajas anteriores con detalle de ventas por turno

> Para registrar una venta **siempre debe haber una caja abierta**.

### Reportes (`/reports.html`)
Exportación de datos:
- **Pagos:** Excel o PDF, con filtro por rango de fechas
- **Miembros:** Excel con todos los miembros y su estado
- **Asistencia:** Excel con filtro por rango de fechas

### Usuarios (`/users.html`)
Solo visible para `admin`:
- CRUD de usuarios del sistema
- Asignación de roles
- Cambio de contraseña opcional al editar

---

## API REST — Endpoints

Todas las rutas (excepto `/api/auth/login` y `/api/plans/public`) requieren el header:
```
Authorization: Bearer <token>
```

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login, devuelve JWT |
| GET | `/api/auth/users` | Listar usuarios (admin) |
| POST | `/api/auth/users` | Crear usuario (admin) |
| PUT | `/api/auth/users/:id` | Actualizar usuario (admin) |
| DELETE | `/api/auth/users/:id` | Eliminar usuario (admin) |

### Miembros
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/members` | Listar con filtros y paginación |
| GET | `/api/members/:id` | Obtener uno |
| POST | `/api/members` | Crear (acepta multipart/form-data con foto) |
| PUT | `/api/members/:id` | Actualizar |
| DELETE | `/api/members/:id` | Eliminar |

**Query params disponibles:** `search`, `active`, `plan_id`, `expiring`, `page`, `limit`

### Planes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/plans/public` | Planes para la landing (sin auth) |
| GET | `/api/plans` | Todos los planes |
| POST | `/api/plans` | Crear (admin) |
| PUT | `/api/plans/:id` | Actualizar (admin) |
| DELETE | `/api/plans/:id` | Eliminar (admin) |

### Pagos
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/payments` | Listar con filtros |
| POST | `/api/payments` | Registrar pago |
| PUT | `/api/payments/:id` | Actualizar |
| DELETE | `/api/payments/:id` | Eliminar |

**Query params:** `member_id`, `status`, `from`, `to`, `page`, `limit`

### Asistencia
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/attendance` | Listar registros |
| POST | `/api/attendance/checkin` | Registrar check-in |
| PUT | `/api/attendance/checkout/:id` | Check-out por ID de registro |
| PUT | `/api/attendance/checkout/member/:member_id` | Check-out por miembro |

### Entrenadores
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/trainers` | Listar |
| GET | `/api/trainers/:id` | Obtener uno |
| POST | `/api/trainers` | Crear (admin, acepta foto) |
| PUT | `/api/trainers/:id` | Actualizar (admin) |
| DELETE | `/api/trainers/:id` | Eliminar (admin) |

### Clases
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/classes` | Listar |
| POST | `/api/classes` | Crear (admin/entrenador) |
| PUT | `/api/classes/:id` | Actualizar |
| DELETE | `/api/classes/:id` | Eliminar (admin) |

### Productos
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/products` | Listar productos |
| GET | `/api/products/categories` | Categorías únicas |
| POST | `/api/products` | Crear (admin, acepta foto) |
| PUT | `/api/products/:id` | Actualizar (admin) |
| DELETE | `/api/products/:id` | Eliminar (admin) |
| GET | `/api/products/sales` | Listar ventas |
| POST | `/api/products/sales` | Registrar venta |
| DELETE | `/api/products/sales/:id` | Eliminar venta (devuelve stock) |

### Caja
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/caja/estado` | Caja actualmente abierta |
| GET | `/api/caja` | Historial de cajas |
| POST | `/api/caja/abrir` | Abrir caja |
| PUT | `/api/caja/cerrar/:id` | Cerrar caja |
| GET | `/api/caja/:id/ventas` | Ventas de una caja específica |

### Dashboard
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dashboard` | Estadísticas generales |

### Reportes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/reports/payments/excel` | Pagos en Excel |
| GET | `/api/reports/payments/pdf` | Pagos en PDF |
| GET | `/api/reports/members/excel` | Miembros en Excel |
| GET | `/api/reports/attendance/excel` | Asistencia en Excel |

**Query params para reportes:** `from`, `to` (fechas en formato `YYYY-MM-DD`)

---

## Almacenamiento de imágenes

El sistema usa `config/storage.js` que decide automáticamente dónde guardar:

### Sin Cloudinary (por defecto)
Las imágenes se guardan en `public/imagenes/<carpeta>/` con nombre único basado en timestamp:
```
public/imagenes/members/1712345678-abc123.jpg
public/imagenes/trainers/1712345679-def456.png
public/imagenes/products/1712345680-ghi789.jpg
```
La URL devuelta es relativa: `/imagenes/members/1712345678-abc123.jpg`

### Con Cloudinary
Si las variables `CLOUDINARY_*` están configuradas en `.env` con valores reales, las imágenes se suben a Cloudinary y se devuelve la URL segura de CDN.

Para activar Cloudinary, edita `.env`:
```env
CLOUDINARY_CLOUD_NAME=mi_cloud
CLOUDINARY_API_KEY=123456789
CLOUDINARY_API_SECRET=mi_secreto
```

---

## Despliegue en Netlify

### Configuración (`netlify.toml`)
```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Pasos para desplegar
1. Sube el proyecto a GitHub (sin `.env` ni `node_modules`)
2. Conecta el repositorio en [netlify.com](https://netlify.com)
3. En **Site settings → Environment variables**, agrega todas las variables del `.env`
4. Para la base de datos usa un servicio en la nube como [Supabase](https://supabase.com), [Railway](https://railway.app) o [Neon](https://neon.tech) y configura `DATABASE_URL`
5. Para las imágenes en producción, configura Cloudinary (el almacenamiento local no funciona en serverless)

> **Importante:** En Netlify el almacenamiento local de imágenes no persiste entre deploys. Se recomienda usar Cloudinary en producción.
