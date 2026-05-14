const mongoose = require('mongoose');
const logger = require('./logger');

/**
 * Transaction Manager - Provides consistent interface for MongoDB transactions
 */
class TransactionManager {
  /**
   * Execute a function within a MongoDB transaction
   * @param {Function} operation - Async function that receives the session
   * @returns {Promise<any>} - Result of the operation
   * @throws {Error} - If the transaction fails
   */
  static async execute(operation) {
    const session = await mongoose.startSession();
    session.startTransaction();

    const startTime = Date.now();
    
    try {
      logger.debug('Transaction started', { service: 'TransactionManager' });

      const result = await operation(session);
      
      await session.commitTransaction();
      
      const duration = Date.now() - startTime;
      logger.info('Transaction committed', {
        duration: `${duration}ms`,
        service: 'TransactionManager'
      });

      // Log warning if transaction is slow
      if (duration > 2000) {
        logger.warn('Slow transaction detected', {
          duration: `${duration}ms`,
          threshold: '2000ms',
          service: 'TransactionManager'
        });
      }

      return result;
    } catch (error) {
      await session.abortTransaction();
      
      logger.error('Transaction error', {
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        service: 'TransactionManager'
      });
      
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Execute multiple operations in parallel within a transaction
   * @param {Function[]} operations - Array of async functions
   * @returns {Promise<any[]>} - Array of results
   */
  static async executeParallel(operations) {
    return this.execute(async (session) => {
      return Promise.all(operations.map(op => op(session)));
    });
  }
}

module.exports = TransactionManager;
