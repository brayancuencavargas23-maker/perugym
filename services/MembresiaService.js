const Membresia = require('../models/Membresia');
const Plan = require('../models/Plan');
const { BusinessError, NotFoundError } = require('../middleware/errors/ErrorTypes');

/**
 * Membresia Service - Manages membership lifecycle operations
 */
class MembresiaService {
  /**
   * Auto-expire memberships that have passed their end date (idempotent)
   * @returns {Promise<number>} - Number of memberships expired
   */
  static async autoVencer() {
    const result = await Membresia.updateMany(
      { fecha_fin: { $lt: new Date() }, estado: 'activo' },
      { $set: { estado: 'vencido' } }
    );
    return result.modifiedCount;
  }

  /**
   * Check if client has an active membership (within transaction)
   * @param {ObjectId} clienteId - Client ID
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<boolean>} - True if client has active membership
   */
  static async tieneMembresiaActiva(clienteId, session) {
    const activa = await Membresia.findOne({
      cliente_id: clienteId,
      estado: 'activo'
    }).session(session);
    
    return !!activa;
  }

  /**
   * Create a new membership with duplicate validation
   * @param {Object} data - Membership data
   * @param {ObjectId} data.cliente_id - Client ID
   * @param {ObjectId} data.plan_id - Plan ID
   * @param {Date} data.fecha_inicio - Start date (optional, defaults to now)
   * @param {string} data.estado_pago - Payment status ('pagado' or 'pendiente')
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Membresia>} - Created membership
   * @throws {BusinessError} - If client already has active membership
   * @throws {NotFoundError} - If plan not found or inactive
   */
  static async crear(data, session) {
    const { cliente_id, plan_id, fecha_inicio, estado_pago = 'pagado' } = data;

    // Check for existing active membership
    const tieneActiva = await this.tieneMembresiaActiva(cliente_id, session);
    if (tieneActiva) {
      throw new BusinessError(
        'El cliente ya tiene una membresía activa. ' +
        'Cancélala o espera que venza antes de asignar una nueva.'
      );
    }

    // Get plan details
    const plan = await Plan.findOne({ _id: plan_id, activo: true }).session(session);
    if (!plan) {
      throw new NotFoundError('Plan no encontrado o inactivo.');
    }

    // Calculate dates
    const inicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + plan.duracion_dias);

    // Determine membership status based on payment status
    const estadoMembresia = estado_pago === 'pendiente' ? 'pendiente' : 'activo';

    // Create membership
    const [membresia] = await Membresia.create(
      [{
        cliente_id,
        plan_id,
        fecha_inicio: inicio,
        fecha_fin: fin,
        estado: estadoMembresia
      }],
      { session }
    );

    return membresia;
  }

  /**
   * Change membership plan (cancels current and creates new)
   * @param {ObjectId} membresiaId - Current membership ID
   * @param {Object} data - New membership data
   * @param {ObjectId} data.plan_id - New plan ID
   * @param {Date} data.fecha_inicio - Start date (optional, defaults to now)
   * @param {string} data.estado_pago - Payment status ('pagado' or 'pendiente')
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Membresia>} - New membership
   * @throws {NotFoundError} - If membership or plan not found
   * @throws {BusinessError} - If membership is not active or pending
   */
  static async cambiarPlan(membresiaId, data, session) {
    const { plan_id, fecha_inicio, estado_pago = 'pagado' } = data;

    // Get current membership
    const mem = await Membresia.findById(membresiaId).session(session);
    if (!mem) {
      throw new NotFoundError('Membresía no encontrada.');
    }

    // Validate membership status
    if (mem.estado !== 'activo' && mem.estado !== 'pendiente') {
      throw new BusinessError(
        'Solo se puede cambiar el plan de una membresía activa o pendiente.'
      );
    }

    // Get new plan details
    const plan = await Plan.findOne({ _id: plan_id, activo: true }).session(session);
    if (!plan) {
      throw new NotFoundError('Plan no encontrado o inactivo.');
    }

    // Cancel current membership
    await Membresia.findByIdAndUpdate(
      membresiaId,
      { estado: 'cancelado' },
      { session }
    );

    // Calculate dates for new membership
    const inicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + plan.duracion_dias);
    const estadoMembresia = estado_pago === 'pendiente' ? 'pendiente' : 'activo';

    // Create new membership
    const [nueva] = await Membresia.create(
      [{
        cliente_id: mem.cliente_id,
        plan_id,
        fecha_inicio: inicio,
        fecha_fin: fin,
        estado: estadoMembresia
      }],
      { session }
    );

    return nueva;
  }

  /**
   * Activate pending membership (when payment is confirmed)
   * @param {ObjectId} membresiaId - Membership ID
   * @param {ClientSession} session - Transaction session (optional)
   * @returns {Promise<Membresia>} - Updated membership
   * @throws {NotFoundError} - If membership not found
   * @throws {BusinessError} - If membership is not pending
   */
  static async activarPendiente(membresiaId, session = null) {
    const options = session ? { session, new: true } : { new: true };

    const membresia = await Membresia.findById(membresiaId).session(session);
    if (!membresia) {
      throw new NotFoundError('Membresía no encontrada.');
    }

    if (membresia.estado !== 'pendiente') {
      throw new BusinessError(
        'Solo se pueden activar membresías en estado pendiente.'
      );
    }

    membresia.estado = 'activo';
    await membresia.save(options);

    return membresia;
  }

  /**
   * Renew expired membership (creates new membership with same plan)
   * @param {ObjectId} membresiaId - Expired membership ID
   * @param {string} estado_pago - Payment status ('pagado' or 'pendiente')
   * @param {ClientSession} session - Transaction session
   * @returns {Promise<Membresia>} - New membership
   * @throws {NotFoundError} - If membership not found
   * @throws {BusinessError} - If membership is still active or client has another active membership
   */
  static async renovar(membresiaId, estado_pago, session) {
    // Get expired membership
    const mem = await Membresia.findById(membresiaId)
      .populate('plan_id')
      .session(session);
    
    if (!mem) {
      throw new NotFoundError('Membresía no encontrada.');
    }

    if (mem.estado === 'activo') {
      throw new BusinessError(
        'La membresía aún está activa. No es necesario renovar.'
      );
    }

    // Check if client has another active membership
    const otraActiva = await Membresia.findOne({
      cliente_id: mem.cliente_id,
      estado: 'activo'
    }).session(session);

    if (otraActiva) {
      throw new BusinessError('El cliente ya tiene una membresía activa.');
    }

    // Calculate dates for new membership
    const inicio = new Date();
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + mem.plan_id.duracion_dias);
    const estadoMembresia = estado_pago === 'pendiente' ? 'pendiente' : 'activo';

    // Create new membership
    const [nueva] = await Membresia.create(
      [{
        cliente_id: mem.cliente_id,
        plan_id: mem.plan_id._id,
        fecha_inicio: inicio,
        fecha_fin: fin,
        estado: estadoMembresia
      }],
      { session }
    );

    return nueva;
  }
}

module.exports = MembresiaService;
