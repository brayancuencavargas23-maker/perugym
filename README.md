# GymPeru - Sistema de Gestión de Gimnasio

Sistema completo de gestión para gimnasios desarrollado con Node.js, Express y MongoDB.

## 🚀 Características

- **Gestión de Clientes**: Registro completo con foto, DNI, contacto y membresías
- **Membresías**: Control de planes, renovaciones, cambios de plan y vencimientos automáticos
- **Caja**: Apertura/cierre de caja, registro de pagos y movimientos
- **Ventas**: Sistema de punto de venta con control de stock
- **Asistencia**: Registro de entrada/salida de clientes
- **Reportes**: Generación de reportes en Excel y PDF
- **Dashboard**: Métricas y estadísticas en tiempo real
- **Landing Page**: Página pública para captación de leads
- **Solicitudes**: Gestión de leads desde la landing page

## 🏗️ Arquitectura

### Stack Tecnológico

- **Backend**: Node.js + Express.js
- **Base de Datos**: MongoDB con Mongoose
- **Autenticación**: JWT (JSON Web Tokens)
- **Almacenamiento**: Cloudinary (con fallback local)
- **Testing**: Jest + Supertest
- **Reportes**: ExcelJS + PDFKit

### Estructura del Proyecto

```
├── config/           # Configuraciones (DB, storage, cloudinary)
├── middleware/       # Middlewares (auth, validation, errorHandler)
├── models/           # Modelos de Mongoose
├── routes/           # Rutas de la API
├── services/         # Lógica de negocio
├── utils/            # Utilidades (TransactionManager, logger)
├── tests/            # Tests (unit, integration, concurrency)
├── public/           # Frontend (HTML, CSS, JS)
├── docs/             # Documentación
└── scripts/          # Scripts de migración
```

### Servicios Principales

- **TransactionManager**: Manejo de transacciones MongoDB con rollback automático
- **StockService**: Gestión atómica de inventario
- **MembresiaService**: Lógica de membresías y renovaciones
- **CajaService**: Operaciones de caja con validaciones

## 📋 Requisitos Previos

- Node.js >= 14.x
- MongoDB >= 4.4
- npm o yarn

## 🔧 Instalación

1. **Clonar el repositorio**
```bash
git clone <repository-url>
cd PeruGym
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**

Copiar `.env.example` a `.env` y configurar:

```env
# MongoDB
MONGO_URI=mongodb://localhost:27017/gym_db

# JWT
JWT_SECRET=your_secret_key_here
JWT_EXPIRES_IN=7d

# Cloudinary (opcional)
CLOUDINARY_ENABLED=false
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# RENIEC API (opcional)
RENIEC_API_URL=https://api.decolecta.com/v1/reniec/dni
RENIEC_API_TOKEN=your_token

# Usuario Desarrollador
DEV_USERNAME=dev
DEV_EMAIL=dev@gym.com
DEV_PASSWORD_HASH=your_bcrypt_hash

# Servidor
PORT=3000
NODE_ENV=development
```

4. **Ejecutar migraciones**
```bash
node scripts/migrations/001_add_indexes.js
```

5. **Iniciar el servidor**
```bash
npm start
```

El servidor estará disponible en `http://localhost:3000`

## 🧪 Testing

### Ejecutar todos los tests
```bash
npm test
```

### Tests por categoría
```bash
npm run test:unit          # Tests unitarios
npm run test:integration   # Tests de integración
npm run test:concurrency   # Tests de concurrencia
npm run test:coverage      # Cobertura de código
```

### Tests en modo watch
```bash
npm run test:watch
```

## 📊 Monitoreo

### Health Check

El sistema expone un endpoint de health check:

```bash
GET /api/health
```

Respuesta:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "ok",
      "state": "connected",
      "host": "localhost"
    },
    "memory": {
      "status": "ok",
      "heapUsed": "45MB",
      "heapTotal": "100MB"
    }
  }
}
```

### Logs Estructurados

Todos los logs están en formato JSON:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "error",
  "message": "Error description",
  "method": "GET",
  "route": "/api/clientes",
  "service": "MongoDB"
}
```

Ver documentación completa en `docs/MONITORING.md`

## 🔐 Seguridad

- **Autenticación JWT**: Tokens con expiración configurable
- **Validación de entrada**: Validadores centralizados con sanitización
- **Rate limiting**: Protección contra fuerza bruta
- **Helmet**: Headers de seguridad HTTP
- **CORS**: Configuración de orígenes permitidos
- **Sanitización de logs**: Información sensible redactada

## 🗄️ Base de Datos

### Modelos Principales

- **Usuario**: Usuarios del sistema (admin, recepcionista)
- **Cliente**: Clientes del gimnasio
- **Plan**: Planes de membresía
- **Membresia**: Membresías activas/vencidas
- **Pago**: Registro de pagos
- **Caja**: Control de caja diaria
- **Producto**: Productos para venta
- **Venta**: Ventas realizadas
- **Asistencia**: Registro de asistencias
- **Solicitud**: Leads desde landing page

### Índices Importantes

- Membresía: Índice único parcial para prevenir membresías activas duplicadas
- Caja: Índice único parcial para prevenir múltiples cajas abiertas
- Venta: Índice compuesto para consultas de caja

## 📚 API Endpoints

### Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/logout` - Cerrar sesión
- `GET /api/auth/users` - Listar usuarios (admin)
- `POST /api/auth/users` - Crear usuario (admin)

### Clientes
- `GET /api/clientes` - Listar clientes
- `GET /api/clientes/:id` - Obtener cliente
- `POST /api/clientes` - Crear cliente
- `PUT /api/clientes/:id` - Actualizar cliente
- `DELETE /api/clientes/:id` - Eliminar cliente
- `GET /api/clientes/reniec/:dni` - Consultar DNI en RENIEC

### Membresías
- `GET /api/membresias` - Listar membresías
- `POST /api/membresias/suscribir` - Crear membresía
- `POST /api/membresias/:id/renovar` - Renovar membresía
- `POST /api/membresias/:id/cambiar-plan` - Cambiar plan
- `PUT /api/membresias/:id` - Actualizar membresía
- `DELETE /api/membresias/:id` - Cancelar membresía

### Caja
- `GET /api/caja/actual` - Obtener caja abierta
- `POST /api/caja/abrir` - Abrir caja
- `POST /api/caja/cerrar` - Cerrar caja
- `GET /api/caja/:id/detalle` - Detalle de caja

### Reportes
- `GET /api/reports/pagos/excel` - Reporte de pagos (Excel)
- `GET /api/reports/clientes/excel` - Reporte de clientes (Excel)
- `GET /api/reports/membresias/excel` - Reporte de membresías (Excel)
- `GET /api/reports/ventas/excel` - Reporte de ventas (Excel)
- `GET /api/reports/stock/excel` - Reporte de stock (Excel)

Ver documentación completa de la API en `docs/API.md`

## 🚀 Despliegue

### Netlify Functions

El proyecto está configurado para despliegue en Netlify:

```bash
npm run build
netlify deploy --prod
```

### Variables de Entorno en Producción

Configurar todas las variables de `.env` en el panel de Netlify.

## 🤝 Contribución

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir un Pull Request

## 📝 Licencia

Este proyecto es privado y confidencial.

## 👥 Equipo

Desarrollado por el equipo de PeruGym

## 📞 Soporte

Para soporte técnico, contactar a: admin@perugym.com
