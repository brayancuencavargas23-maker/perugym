const OpenAI = require('openai');
const { FUNCTIONS_DEFINITIONS, FUNCTIONS_MAP } = require('../functions/agenteFunctions');

const SYSTEM_PROMPT = `Eres el asistente de PeruGym. Respondes SOLO consultas del gimnasio en español.

REGLAS GENERALES:
- Sé breve y directo (máximo 3 líneas en respuestas simples).
- Si no hay resultados, di "No se encontraron resultados".
- Si la pregunta no es del gimnasio, responde: "Solo puedo ayudar con consultas del gimnasio."
- Consulta herramientas para cifras reales; nunca inventes saldos, fechas, reportes ni confirmaciones de envío.
- Usa generar_reporte para reportes y comparaciones; recomendar_acciones para recomendaciones y prioridades.
- Para informes puedes responder hasta 12 líneas con período, cifras y acciones concretas. Distingue ingresos de utilidad y saldos actuales de cifras del período.
- Las recomendaciones son señales verificables, no predicciones de abandono.
- Para mensajes usa preparar_mensaje_cliente. Primero identifica al cliente; si hay varias coincidencias, pregunta cuál. El usuario revisa el borrador y lo envía desde WhatsApp. Nunca digas que ya fue enviado.
- Los botones de descarga y mensajes se muestran automáticamente cuando la herramienta los devuelve. No inventes enlaces ni pegues URLs internas.
- Si no se indica período, usa mes hasta hoy. La semana del reporte son los últimos 7 días; el cupo de asistencia es de lunes a domingo.

SECCIONES DE LECTURA (responde directamente):
- Clientes: buscar por nombre/DNI, perfil completo
- Membresías: activas, vencidas, por vencer, historial
- Pagos: historial, estado de cuenta, abonos
- Asistencia: registros, aforo actual
- Dashboard: estadísticas, top clientes, comparativas, insights
- Productos: buscar, categorías, bajo stock
- Caja: estado, resumen, movimientos
- Planes: listar precios
- Leads: estadísticas, listar por estado
- Ventas: resumen del día, recientes
- RENIEC: buscar por DNI

FLUJO DE ESCRITURA (siempre pide confirmación):
1. El usuario pide una acción (registrar cliente, suscribir, pago, check-in, checkout, cambiar estado lead)
2. Tú llamas a la función "preparar_*" correspondiente
3. Muestras el preview que retorna la función
4. Pides confirmación: "¿Confirmas?"
5. Solo cuando el usuario diga "sí", "confirmo" o "dale", llamas a "ejecutar_*"
6. Si el usuario dice "no" o "cancela", cancelas la operación

REGLAS PARA ESCRITURA:
- NUNCA ejecutes una función de escritura sin confirmación previa
- Si el usuario da solo DNI para registrar, busca RENIEC automáticamente
- NO preguntes por descuento (se aplica solo si el usuario lo menciona)
- NO preguntes por fecha de inicio (usa hoy)
- Para membresías: pregunta plan, método de pago y si es completo o abono
- Si falta caja abierta, avisa antes de intentar

EJEMPLOS DE ESCRITURA:
P: "Registra a Juan Pérez, DNI 12345678, tel 999"
R: [busca RENIEC] → muestra preview → "¿Confirmas?"
P: "sí"
R: ✅ Cliente registrado

P: "Dale membresía Pro a Juan, yape, abono de 50"
R: [prepara suscripción] → muestra preview → "¿Confirmas?"
P: "sí"
R: ✅ Membresía creada

P: "Check-in de Juan"
R: [ejecuta directamente] → ✅ Check-in registrado`;

// Tools en formato OpenAI
const TOOLS = FUNCTIONS_DEFINITIONS.map(fn => ({
  type: 'function',
  function: {
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
  },
}));

// Almacén en memoria de historiales por usuario
const historiales = new Map();
const MAX_HISTORIAL = 15;

function obtenerHistorial(usuarioId) {
  if (!historiales.has(usuarioId)) {
    historiales.set(usuarioId, []);
  }
  return historiales.get(usuarioId);
}

function guardarMensaje(usuarioId, role, contenido, acciones = []) {
  const historial = obtenerHistorial(usuarioId);
  historial.push({ role, content: contenido, ...(acciones.length ? { acciones } : {}) });
  if (historial.length > MAX_HISTORIAL) {
    historial.splice(0, historial.length - MAX_HISTORIAL);
  }
}

async function ejecutarFuncion(nombre, args, usuario) {
  const fn = FUNCTIONS_MAP[nombre];
  if (!fn) throw new Error(`Función no encontrada: ${nombre}`);
  if (['generar_reporte', 'recomendar_acciones', 'preparar_mensaje_cliente'].includes(nombre) && !['admin', 'recepcionista'].includes(usuario?.role)) {
    throw new Error('Tu rol no permite esta operación.');
  }

  let parsed = args;
  if (typeof args === 'string') {
    try { parsed = JSON.parse(args); } catch { parsed = {}; }
  }

  const resultado = await fn(parsed);
  JSON.stringify(resultado).substring(0, 120);
  return resultado;
}

async function chat(mensaje, usuarioId, usuario = {}) {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'tu_api_key_de_groq_aqui') {
    return {
      respuesta: 'El chat IA no está configurado. Puedes usar los botones de Reportes, Recomendaciones y Mensajes; funcionan sin IA.',
      historial: [],
    };
  }

  guardarMensaje(usuarioId, 'user', mensaje);
  const historial = obtenerHistorial(usuarioId);

  try {
    const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1', timeout: 30000, maxRetries: 1 });
    const acciones = [];
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + `\nFecha y hora actuales en Perú: ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}.` },
      ...historial.map(({ role, content }) => ({ role, content })),
    ];

    let response = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 1400,
    });

    let assistantMessage = response.choices[0].message;

    // Si Groq pide ejecutar funciones
    let iteraciones = 0;
    while (assistantMessage.tool_calls?.length > 0 && iteraciones < 5) {
      iteraciones++;

      // Limpiar y agregar mensaje del asistente (solo campos necesarios)
      const cleanAssistant = {
        role: 'assistant',
        content: assistantMessage.content || null,
        tool_calls: assistantMessage.tool_calls,
      };
      messages.push(cleanAssistant);

      for (const tc of assistantMessage.tool_calls) {
        const nombre = tc.function?.name;
        let args;
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }

        let resultado;
        try {
          resultado = await ejecutarFuncion(nombre, args, usuario);
          if (['generar_reporte', 'recomendar_acciones', 'preparar_mensaje_cliente'].includes(nombre) && Array.isArray(resultado.acciones)) {
            acciones.push(...resultado.acciones);
          }
        } catch (fnError) {
          resultado = { error: fnError.message };
        }

        // Agregar resultado de la función al historial
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(resultado),
        });
      }

      // Obtener siguiente respuesta
      response = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages,
        tools: TOOLS,
        tool_choice: iteraciones >= 5 ? 'none' : 'auto',
        temperature: 0.2,
        max_tokens: 1400,
      });

      assistantMessage = response.choices[0].message;
    }

    const respuesta = assistantMessage.content || 'No pude generar una respuesta.';
    const botones = [...new Map(acciones.map(a => [JSON.stringify(a), a])).values()].slice(0, 20);
    guardarMensaje(usuarioId, 'assistant', respuesta, botones);

    return {
      respuesta,
      acciones: botones,
      historial: historial.map(m => ({
        role: m.role,
        content: m.content,
        acciones: m.acciones || [],
      })),
    };
  } catch (error) {
    console.error('[Agente] Error:', error.message);

    if (error.status === 401) {
      return {
        respuesta: '⚠️ La clave de API de Groq no es válida.',
        historial: [],
      };
    }

    if (error.status === 429) {
      return {
        respuesta: '⏳ Límite de consultas alcanzado. Espera un momento.',
        historial: [],
      };
    }

    return {
      respuesta: 'No pude consultar el chat IA en este momento. Intenta de nuevo o usa los accesos directos a reportes, recomendaciones y mensajes.',
      historial: [],
    };
  }
}

function limpiarHistorial(usuarioId) {
  historiales.delete(usuarioId);
}

module.exports = { chat, limpiarHistorial, obtenerHistorial };
