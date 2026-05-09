# 🔍 DEBUG - Error "Cannot set properties of null"

## Por favor ejecuta esto en la consola:

```javascript
// Habilitar pause on exceptions
// 1. Ve a DevTools → Sources
// 2. En el panel derecho, activa "Pause on exceptions" (⏸️)
// 3. Navega entre páginas
// 4. Cuando se pause, toma captura del stack trace
```

## O ejecuta esto para capturar el error:

```javascript
// Interceptar el error
window.addEventListener('error', (e) => {
  if (e.message.includes('innerHTML')) {
    console.error('🔴 ERROR CAPTURADO:', {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack
    });
  }
});

console.log('✅ Listener de errores activado. Navega entre páginas.');
```

## Mientras tanto, envíame:

1. **Captura de la pestaña Console** mostrando el error completo con el stack trace
2. **¿En qué página ocurre?** (Clientes, Solicitudes, otra?)
3. **¿Cuándo ocurre?** (Al cargar, al navegar, al hacer click en algo?)
