# Monitoring & Alerting Guide

Este documento describe cómo configurar alertas y monitorear el sistema GymPeru.

## Health Check Endpoint

El sistema expone un endpoint de health check en `/api/health` que devuelve:

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
      "heapTotal": "100MB",
      "rss": "120MB"
    }
  }
}
```

- **Status Code**: 200 si todo está bien, 503 si hay problemas
- **Frecuencia recomendada**: Cada 30 segundos

## Structured Logging

Todos los logs están en formato JSON estructurado con los siguientes campos:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "error|warn|info|debug",
  "message": "Descripción del evento",
  "method": "GET",
  "route": "/api/clientes",
  "ip": "192.168.1.1",
  "userId": "user_id",
  "service": "MongoDB|Cloudinary|RENIEC|TransactionManager",
  "error": "Error message if applicable"
}
```

## Métricas Clave a Monitorear

### 1. Disponibilidad del Sistema

**Métrica**: Health check endpoint status
**Alerta**: Si el endpoint devuelve 503 o no responde
**Acción**: Verificar conexión a MongoDB y recursos del servidor

### 2. Conexión a MongoDB

**Métrica**: `checks.database.status` en health check
**Logs a buscar**: 
- `"message": "MongoDB disconnected"`
- `"message": "MongoDB error"`

**Alerta**: Si MongoDB se desconecta o hay errores de conexión
**Acción**: Verificar estado del servidor MongoDB y red

### 3. Transacciones Lentas

**Métrica**: Duración de transacciones
**Logs a buscar**: `"message": "Slow transaction detected"`
**Umbral**: > 2 segundos
**Alerta**: Si hay más de 5 transacciones lentas en 5 minutos
**Acción**: Revisar queries, índices y carga del servidor

### 4. Errores de Integraciones Externas

#### RENIEC
**Logs a buscar**: 
- `"message": "RENIEC timeout"`
- `"message": "RENIEC error"`

**Alerta**: Si hay más de 10 errores en 10 minutos
**Acción**: Verificar conectividad con API RENIEC

#### Cloudinary
**Logs a buscar**: 
- `"message": "Cloudinary upload error"`
- `"message": "Using local storage as fallback"`

**Alerta**: Si se usa fallback local más de 5 veces en 10 minutos
**Acción**: Verificar configuración y cuota de Cloudinary

### 5. Errores de Aplicación

**Logs a buscar**: `"level": "error"`
**Alerta**: Si hay más de 20 errores en 5 minutos
**Acción**: Revisar logs para identificar causa raíz

### 6. Uso de Memoria

**Métrica**: `checks.memory.heapUsed` en health check
**Alerta**: Si heap usado > 80% del heap total
**Acción**: Investigar memory leaks o aumentar recursos

### 7. Uptime

**Métrica**: `uptime` en health check
**Alerta**: Si el servidor se reinicia inesperadamente (uptime < 5 minutos)
**Acción**: Revisar logs de sistema y errores fatales

## Configuración de Alertas

### Opción 1: Log Aggregation Service (Recomendado)

Usar un servicio como:
- **Datadog**: Integración con logs JSON
- **New Relic**: APM y logging
- **Elastic Stack**: Elasticsearch + Kibana
- **Grafana Loki**: Para logs estructurados

**Configuración básica**:
1. Configurar el servicio para leer logs de stdout/stderr
2. Crear queries basadas en los campos JSON
3. Configurar alertas según las métricas clave

### Opción 2: Script de Monitoreo Simple

Crear un script que:
1. Llame al endpoint `/api/health` cada 30 segundos
2. Verifique el status code y el campo `status`
3. Envíe notificación si hay problemas

Ejemplo con curl y email:

```bash
#!/bin/bash
HEALTH_URL="https://tu-dominio.com/api/health"
EMAIL="admin@gym.com"

response=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $response -ne 200 ]; then
  echo "Health check failed with status $response" | mail -s "GymPeru Alert" $EMAIL
fi
```

### Opción 3: Uptime Monitoring Services

Usar servicios como:
- **UptimeRobot**: Monitoreo gratuito cada 5 minutos
- **Pingdom**: Monitoreo avanzado
- **StatusCake**: Alternativa gratuita

**Configuración**:
1. Agregar el endpoint `/api/health`
2. Configurar para verificar status code 200
3. Configurar notificaciones por email/SMS

## Queries de Logs Útiles

### Buscar errores de transacciones
```
level:"error" AND service:"TransactionManager"
```

### Buscar transacciones lentas
```
level:"warn" AND message:"Slow transaction detected"
```

### Buscar errores de MongoDB
```
level:"error" AND service:"MongoDB"
```

### Buscar uso de fallback de Cloudinary
```
level:"warn" AND message:"Using local storage as fallback"
```

### Buscar timeouts de RENIEC
```
level:"error" AND service:"RENIEC" AND message:"timeout"
```

## Dashboard Recomendado

Crear un dashboard con:

1. **Status General**
   - Health check status (verde/rojo)
   - Uptime del servidor
   - Estado de MongoDB

2. **Métricas de Performance**
   - Duración promedio de transacciones
   - Número de transacciones lentas (últimas 24h)
   - Uso de memoria

3. **Errores**
   - Total de errores (últimas 24h)
   - Errores por servicio (MongoDB, RENIEC, Cloudinary)
   - Top 5 errores más frecuentes

4. **Integraciones Externas**
   - Tasa de éxito de RENIEC
   - Tasa de éxito de Cloudinary
   - Uso de fallback local

## Acciones Preventivas

1. **Revisar logs diariamente** para identificar patrones
2. **Monitorear tendencias** de transacciones lentas
3. **Verificar espacio en disco** para almacenamiento local
4. **Revisar cuotas** de servicios externos (Cloudinary, RENIEC)
5. **Actualizar índices** si hay queries lentas recurrentes

## Contacto en Caso de Emergencia

Definir un plan de escalación:
1. **Nivel 1**: Alertas automáticas por email
2. **Nivel 2**: Si no se resuelve en 15 minutos, SMS al administrador
3. **Nivel 3**: Si no se resuelve en 1 hora, llamada telefónica

## Mantenimiento Regular

- **Diario**: Revisar dashboard y alertas
- **Semanal**: Analizar tendencias de performance
- **Mensual**: Revisar y ajustar umbrales de alertas
- **Trimestral**: Auditoría completa de logs y métricas
