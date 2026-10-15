jest.mock('openai', () => jest.fn());
jest.mock('../../../functions/agenteFunctions', () => ({
  FUNCTIONS_DEFINITIONS: [{ name: 'generar_reporte', description: 'Reporte', parameters: { type: 'object', properties: {} } }],
  FUNCTIONS_MAP: { generar_reporte: jest.fn() },
}));
const OpenAI = require('openai');
const { FUNCTIONS_MAP } = require('../../../functions/agenteFunctions');
const Agente = require('../../../services/AgenteService');
const oldKey = process.env.GROQ_API_KEY;
afterAll(() => { if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey; });
beforeEach(() => { process.env.GROQ_API_KEY = 'fake-test'; Agente.limpiarHistorial('test'); });

test('el chat sin clave ofrece accesos directos y no instancia el proveedor', async () => {
  delete process.env.GROQ_API_KEY;
  const result = await Agente.chat('Hola', 'test', { role: 'admin' });
  expect(result.respuesta).toContain('funcionan sin IA');
  expect(OpenAI).not.toHaveBeenCalled();
});

test('herramientas devuelven acciones estructuradas y se preservan en el historial', async () => {
  const action = { tipo: 'descarga', path: '/reports/analytics/excel?from=2026-09-01&to=2026-09-28', archivo: 'reporte.xlsx' };
  FUNCTIONS_MAP.generar_reporte.mockResolvedValue({ respuesta: 'Ingresos: 40', acciones: [action] });
  const create = jest.fn().mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: '1', type: 'function', function: { name: 'generar_reporte', arguments: '{"periodo":"mes"}' } }] } }] })
    .mockResolvedValue({ choices: [{ message: { content: 'Reporte preparado.' } }] });
  OpenAI.mockImplementation(() => ({ chat: { completions: { create } } }));
  const result = await Agente.chat('Reporte mensual', 'test', { role: 'admin' });
  expect(result.acciones).toEqual([action]);
  expect(Agente.obtenerHistorial('test').at(-1).acciones).toEqual([action]);
  expect(FUNCTIONS_MAP.generar_reporte).toHaveBeenCalledWith({ periodo: 'mes' });
  await Agente.chat('Gracias', 'test', { role: 'admin' });
  const messages = create.mock.calls.at(-1)[0].messages;
  expect(messages.filter(m => m.role === 'assistant').every(m => !('acciones' in m))).toBe(true);
});

test('un rol no autorizado no ejecuta la herramienta nueva', async () => {
  const create = jest.fn().mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: '1', type: 'function', function: { name: 'generar_reporte', arguments: '{}' } }] } }] })
    .mockResolvedValue({ choices: [{ message: { content: 'Sin acceso.' } }] });
  OpenAI.mockImplementation(() => ({ chat: { completions: { create } } }));
  await Agente.chat('Reporte', 'test', { role: 'invitado' });
  expect(FUNCTIONS_MAP.generar_reporte).not.toHaveBeenCalled();
});
