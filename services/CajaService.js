const Caja = require('../models/Caja');
const Pago = require('../models/Pago');
const Venta = require('../models/Venta');
const MovimientoCaja = require('../models/MovimientoCaja');
const { BusinessError, NotFoundError } = require('../middleware/errors/ErrorTypes');

/**
 * Caja Service - Manages cash register operations
 */
class CajaService {
  /**
   * Get currently open cash register
   * @param {ClientSession} session - Transaction session (optional)
   * @returns {Promise<Caja|null>} - Open cash register or null
   */
  static async obtenerCajaAbierta(session = null) {
    const query = Caja.findOne({ estado: 'abierta' }).sort({ apertura: -1 });
    
    if (session) {
      query.session(session);
    }
    
    return await query;
  }

  /**
   * Open a new cash register
   * @param {Object} data - Cash register data
   * @param {ObjectId} data.usuario_id - User ID
   * @param {number} data.monto_inicial - Initial amount (optional, defaults to 0)
   * @param {string} data.notas - Notes (optional)
   * @param {ClientSession} session - Transaction session (optional)
   * @returns {Promise<Caja>} - Created cash register
   * @throws {BusinessError} - If there's already an open cash register
   */
  static async abrir(data, session = null) {
    const { usuario_id, monto_inicial = 0, notas = null } = data;

    // Check if there's already an open cash register
    const abierta = await this.obtenerCajaAbierta(session);
    if (abierta) {
      throw new BusinessError('Ya hay una caja abierta.');
    }

    // Create new cash register
    const cajaData = {
      usuario_id,
      monto_inicial,
      notas,
      estado: 'abierta'
    };

    let caja;
    if (session) {
      [caja] = await Caja.create([cajaData], { session });
    } else {
      caja = await Caja.create(cajaData);
    }

    return caja;
  }

  /**
   * Close cash register atomically
   * @param {ObjectId} cajaId - Cash register ID
   * @param {Object} data - Closing data
   * @param {number} data.monto_final - Final amount
   * @param {string} data.notas - Notes (optional)
   * @param {ClientSession} session - Transaction session (optional)
   * @returns {Promise<Caja>} - Closed cash register
   * @throws {NotFoundError} - If cash register not found or already closed
   */
  static async cerrar(cajaId, data, session = null) {
    const { monto_final = 0, notas } = data;

    // Calculate total income from all sources
    const total_ingresos = await this.calcularTotalIngresos(cajaId, session);

    // Close cash register atomically (only if it's open)
    const updateData = {
      estado: 'cerrada',
      cierre: new Date(),
      monto_final,
      total_ingresos
    };

    if (notas) {
      updateData.notas = notas;
    }

    const options = { new: true };
    if (session) {
      options.session = session;
    }

    const caja = await Caja.findOneAndUpdate(
      { _id: cajaId, estado: 'abierta' },
      updateData,
      options
    );

    if (!caja) {
      throw new NotFoundError('Caja no encontrada o ya cerrada.');
    }

    return caja;
  }

  /**
   * Calculate total income for a cash register
   * @param {ObjectId} cajaId - Cash register ID
   * @param {ClientSession} session - Transaction session (optional)
   * @returns {Promise<number>} - Total income
   */
  static async calcularTotalIngresos(cajaId, session = null) {
    const mongoose = require('mongoose');
    const oid = mongoose.Types.ObjectId.createFromHexString(cajaId.toString());

    // Income from memberships (paid payments)
    const ingresosMembresiasPipeline = [
      { $match: { caja_id: oid, estado: 'pagado' } },
      { $group: { _id: null, total: { $sum: '$monto' } } }
    ];
    
    const ingresosMembresias = session
      ? await Pago.aggregate(ingresosMembresiasPipeline).session(session)
      : await Pago.aggregate(ingresosMembresiasPipeline);

    // Income from sales (non-cancelled)
    const ingresosVentasPipeline = [
      { $match: { caja_id: oid, anulada: false } },
      { $unwind: '$items' },
      { $group: { _id: null, total: { $sum: '$items.subtotal' } } }
    ];
    
    const ingresosVentas = session
      ? await Venta.aggregate(ingresosVentasPipeline).session(session)
      : await Venta.aggregate(ingresosVentasPipeline);

    // Manual movements (income - expenses)
    const movimientosPipeline = [
      { $match: { caja_id: oid } },
      { $group: { _id: '$tipo', total: { $sum: '$monto' } } }
    ];
    
    const movimientos = session
      ? await MovimientoCaja.aggregate(movimientosPipeline).session(session)
      : await MovimientoCaja.aggregate(movimientosPipeline);

    const ingresosManuales = movimientos.find(m => m._id === 'ingreso')?.total || 0;
    const egresosManuales = movimientos.find(m => m._id === 'egreso')?.total || 0;

    // Calculate total
    const totalMembresias = ingresosMembresias[0]?.total || 0;
    const totalVentas = ingresosVentas[0]?.total || 0;
    const totalMovimientos = ingresosManuales - egresosManuales;

    return totalMembresias + totalVentas + totalMovimientos;
  }

  /**
   * Register manual movement (income or expense)
   * @param {ObjectId} cajaId - Cash register ID
   * @param {Object} data - Movement data
   * @param {ObjectId} data.usuario_id - User ID
   * @param {string} data.tipo - Type ('ingreso' or 'egreso')
   * @param {number} data.monto - Amount
   * @param {string} data.concepto - Concept/description
   * @param {ClientSession} session - Transaction session (optional)
   * @returns {Promise<MovimientoCaja>} - Created movement
   * @throws {BusinessError} - If validation fails
   */
  static async registrarMovimiento(cajaId, data, session = null) {
    const { usuario_id, tipo, monto, concepto } = data;

    // Validate cash register is open
    const caja = await Caja.findOne({ _id: cajaId, estado: 'abierta' })
      .session(session);
    
    if (!caja) {
      throw new BusinessError('La caja no está abierta.');
    }

    // Validate type
    if (!['ingreso', 'egreso'].includes(tipo)) {
      throw new BusinessError('Tipo inválido. Debe ser "ingreso" o "egreso".');
    }

    // Validate amount
    if (!monto || isNaN(monto) || parseFloat(monto) <= 0) {
      throw new BusinessError('Monto inválido. Debe ser mayor a 0.');
    }

    // Validate concept
    if (!concepto || !concepto.trim()) {
      throw new BusinessError('El concepto es requerido.');
    }

    // Create movement
    const movimientoData = {
      caja_id: cajaId,
      usuario_id,
      tipo,
      monto: parseFloat(monto),
      concepto: concepto.trim()
    };

    let movimiento;
    if (session) {
      [movimiento] = await MovimientoCaja.create([movimientoData], { session });
    } else {
      movimiento = await MovimientoCaja.create(movimientoData);
    }

    return movimiento;
  }
}

module.exports = CajaService;
