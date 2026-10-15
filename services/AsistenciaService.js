const mongoose = require('mongoose');
const Cliente = require('../models/Cliente');
const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const Asistencia = require('../models/Asistencia');
const { periodosLima, condicionesPlan } = require('../utils/asistenciaPolicy');
const { vistaMembresia } = require('../utils/membresiaPeriodos');

function fallo(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

class AsistenciaService {
  static async disponibilidad(clienteId, now = new Date()) {
    if (!mongoose.isObjectIdOrHexString(clienteId)) throw fallo('Cliente inválido.');
    const cliente = await Cliente.findById(clienteId);
    if (!cliente) throw fallo('Cliente no encontrado.', 404);
    if (!cliente.activo) throw fallo('El cliente está inactivo.');
    const contrato = await Membresia.findOne({ cliente_id: clienteId, estado: { $ne: 'cancelado' },
      fecha_inicio: { $lte: now }, fecha_fin: { $gt: now } }).sort({ fecha_inicio: -1 });
    const membresia = contrato ? vistaMembresia(contrato, now) : null;
    if (!membresia || membresia.estado !== 'activo') throw fallo('El cliente no tiene una membresía activa y vigente.');
    const plan = await Plan.findById(membresia.plan_id);
    if (!membresia.condiciones_asistencia) {
      if (!plan) throw fallo('El plan de esta membresía no existe. Revisa su configuración.');
      // Contratos antiguos: conservar la primera copia creada.
      await Membresia.updateOne({ _id: membresia._id, condiciones_asistencia: { $exists: false } },
        { $set: { condiciones_asistencia: condicionesPlan(plan) } });
      const actual = await Membresia.findById(membresia._id);
      membresia.condiciones_asistencia = actual.condiciones_asistencia;
    }
    const periodos = periodosLima(now);
    // Renovar o cambiar de plan no reinicia el consumo semanal del cliente.
    const usadas = await Asistencia.countDocuments({ cliente_id: clienteId,
      entrada: { $gte: periodos.inicioSemana, $lt: periodos.finSemana } });
    const hoy = await Asistencia.countDocuments({ cliente_id: clienteId,
      entrada: { $gte: periodos.inicioDia, $lt: periodos.finDia } });
    const abierta = await Asistencia.exists({ cliente_id: clienteId, salida: null });
    const limite = membresia.condiciones_asistencia.limite_semanal;
    let motivo = null;
    if (abierta) motivo = 'El cliente tiene una entrada sin salida registrada. Registra su salida primero.';
    else if (limite != null && usadas >= limite) motivo = `Límite semanal alcanzado: ${usadas}/${limite} visitas. El cupo se renueva el lunes ${periodos.finSemana.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}, si la membresía sigue vigente.`;
    else if (hoy >= 1) motivo = 'El cliente ya utilizó su visita de hoy. Máximo una visita diaria.';
    return { permitido: !motivo, motivo, plan_nombre: membresia.plan_nombre || plan?.nombre || 'Plan contratado',
      membresia_id: membresia._id, fecha_fin: membresia.fecha_fin,
      periodo_id: membresia.periodo_actual_id || null,
      limite_semanal: limite, limite_diario: 1, visitas_semana: usadas,
      disponibles: limite == null ? null : Math.max(0, limite - usadas),
      reinicio_semanal: periodos.finSemana, periodos };
  }

  static async registrar(clienteId, now = new Date()) {
    await Asistencia.init();
    const estado = await this.disponibilidad(clienteId, now);
    if (!estado.permitido) throw fallo(estado.motivo);
    try {
      return await Asistencia.create({ cliente_id: clienteId, membresia_id: estado.membresia_id,
        periodo_id: estado.periodo_id,
        entrada: now, fecha: estado.periodos.inicioDia, dia_local: estado.periodos.dia,
        semana_local: estado.periodos.semana, cupo_semanal: estado.visitas_semana + 1 });
    } catch (err) {
      if (err.code === 11000) throw fallo('Ya se registró una entrada simultánea para este cliente. Actualiza su asistencia.', 409);
      throw err;
    }
  }
}

module.exports = AsistenciaService;
