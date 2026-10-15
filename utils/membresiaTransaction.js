const TransactionManager = require('./TransactionManager');
const { ConflictError } = require('../middleware/errors/ErrorTypes');

module.exports = async operation => {
  try { return await TransactionManager.execute(operation); }
  catch (err) {
    if (err.code === 112 || err.hasErrorLabel?.('TransientTransactionError')) {
      throw new ConflictError('Otra operación modificó la membresía o el saldo. Recarga e intenta de nuevo.');
    }
    throw err;
  }
};
