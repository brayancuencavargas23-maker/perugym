const mongoose = require('mongoose');
const TransactionManager = require('../../../utils/TransactionManager');
const { setupTestDB, teardownTestDB } = require('../../helpers/setup');

describe('TransactionManager', () => {
  beforeAll(async () => await setupTestDB());
  afterAll(async () => await teardownTestDB());

  describe('execute', () => {
    it('should commit transaction when operation succeeds', async () => {
      const result = await TransactionManager.execute(async (session) => {
        return { success: true };
      });

      expect(result).toEqual({ success: true });
    });

    it('should rollback transaction when operation fails', async () => {
      await expect(
        TransactionManager.execute(async (session) => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });

    it('should always end session even if operation fails', async () => {
      const sessionSpy = jest.spyOn(mongoose, 'startSession');
      
      try {
        await TransactionManager.execute(async (session) => {
          throw new Error('Test error');
        });
      } catch (error) {
        // Expected error
      }

      // Session should be ended
      expect(sessionSpy).toHaveBeenCalled();
      sessionSpy.mockRestore();
    });
  });

  describe('executeParallel', () => {
    it('should execute multiple operations in parallel', async () => {
      const operations = [
        async (session) => ({ result: 1 }),
        async (session) => ({ result: 2 }),
        async (session) => ({ result: 3 })
      ];

      const results = await TransactionManager.executeParallel(operations);

      expect(results).toEqual([
        { result: 1 },
        { result: 2 },
        { result: 3 }
      ]);
    });

    it('should rollback all operations if one fails', async () => {
      const operations = [
        async (session) => ({ result: 1 }),
        async (session) => { throw new Error('Operation 2 failed'); },
        async (session) => ({ result: 3 })
      ];

      await expect(
        TransactionManager.executeParallel(operations)
      ).rejects.toThrow('Operation 2 failed');
    });
  });
});
