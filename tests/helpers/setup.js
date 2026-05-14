const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

let mongoServer;

/**
 * Setup test database using MongoDB Memory Server with replica set support
 */
async function setupTestDB() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30000
  });
  
  // Wait for replica set to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));
}

/**
 * Teardown test database and stop MongoDB Memory Server
 */
async function teardownTestDB() {
  await mongoose.disconnect();
  await mongoServer.stop();
}

/**
 * Clear all collections in the database
 */
async function clearDatabase() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
  }
}

/**
 * Create authentication token for testing
 * @param {Object} userData - User data to include in token
 * @returns {string} JWT token
 */
function createAuthToken(userData = {}) {
  return jwt.sign(
    {
      id: userData.id || new mongoose.Types.ObjectId(),
      role: userData.role || 'recepcionista',
      email: userData.email || 'test@test.com',
      name: userData.name || 'Test User'
    },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

module.exports = {
  setupTestDB,
  teardownTestDB,
  clearDatabase,
  createAuthToken
};
