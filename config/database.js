const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
require('dotenv').config();

const DB_MODE = process.env.DB_MODE || 'mongo';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gym_db';
const EXPORT_DIR = path.join(__dirname, '..', 'db-export');

async function connectMongo() {
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  logger.info('MongoDB connected', {
    host: mongoose.connection.host,
    database: mongoose.connection.name,
    service: 'MongoDB'
  });
}

async function exportToJson() {
  if (DB_MODE !== 'json') return;
  const db = mongoose.connection.db;
  if (!db) return;

  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }

  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    try {
      const docs = await db.collection(col.name).find({}).toArray();
      const filePath = path.join(EXPORT_DIR, `${col.name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
    } catch (err) {
      console.error(`  [JSON] Error exportando ${col.name}:`, err.message);
    }
  }
}

function setupAutoSync() {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }

  const syncCollection = async (colName) => {
    try {
      const db = mongoose.connection.db;
      if (!db) return;
      const docs = await db.collection(colName).find({}).toArray();
      const filePath = path.join(EXPORT_DIR, `${colName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
      console.log(`  [JSON-SYNC] ${colName}: ${docs.length} docs → JSON`);
    } catch (err) {
      console.error(`  [JSON-SYNC] Error sync ${colName}:`, err.message);
    }
  };

  const modelNames = mongoose.modelNames();
  for (const name of modelNames) {
    const model = mongoose.model(name);
    const colName = model.collection.name;
    const sync = () => syncCollection(colName);

    const origSave = model.prototype.save;
    model.prototype.save = function(...args) {
      const result = origSave.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.then(r => { sync(); return r; });
      }
      sync();
      return result;
    };

    const staticMethods = ['create', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'findByIdAndUpdate', 'findByIdAndDelete'];
    for (const method of staticMethods) {
      if (model[method]) {
        const orig = model[method];
        model[method] = function(...args) {
          const result = orig.apply(this, args);
          if (result && typeof result.then === 'function') {
            return result.then(r => { sync(); return r; });
          }
          sync();
          return result;
        };
      }
    }
  }
  console.log(`  [JSON-SYNC] Auto-sync activo para ${modelNames.length} modelos (method wrap)`);
}

async function connectLocal() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const memServer = await MongoMemoryServer.create();
  const uri = memServer.getUri();
  await mongoose.connect(uri);
  logger.info('MongoDB Memory connected', { service: 'MongoDB-Memory' });

  const files = fs.readdirSync(EXPORT_DIR).filter(f => f.endsWith('.json'));
  const db = mongoose.connection.db;

  for (const file of files) {
    const collectionName = file.replace('.json', '');
    const filePath = path.join(EXPORT_DIR, file);
    const rawData = fs.readFileSync(filePath, 'utf8');
    let docs = JSON.parse(rawData);

    if (docs.length === 0) continue;

    docs = docs.map(doc => {
      const cleaned = { ...doc };
      if (cleaned._id && typeof cleaned._id === 'string') {
        try { cleaned._id = new mongoose.Types.ObjectId(cleaned._id); } catch { /* keep */ }
      }
      const refFields = ['usuario_id','cliente_id','caja_id','membresia_id','plan_id','producto_id'];
      for (const field of refFields) {
        if (cleaned[field] && typeof cleaned[field] === 'string') {
          try { cleaned[field] = new mongoose.Types.ObjectId(cleaned[field]); } catch { /* keep */ }
        }
      }
      if (cleaned.items && Array.isArray(cleaned.items)) {
        cleaned.items = cleaned.items.map(item => {
          const c = { ...item };
          if (c.producto_id && typeof c.producto_id === 'string') {
            try { c.producto_id = new mongoose.Types.ObjectId(c.producto_id); } catch { /* keep */ }
          }
          return c;
        });
      }
      return cleaned;
    });

    try {
      await db.collection(collectionName).insertMany(docs);
      console.log(`  [JSON] ${collectionName}: ${docs.length} documentos cargados`);
    } catch (err) {
      console.error(`  [JSON] Error cargando ${collectionName}:`, err.message);
    }
  }

  setupAutoSync();
  console.log('✅ Base de datos local inicializada desde JSON');
}

process.on('SIGINT', async () => {
  if (DB_MODE === 'json' && mongoose.connection.readyState === 1) {
    console.log('\n🔄 Exportando datos a JSON antes de cerrar...');
    await exportToJson();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (DB_MODE === 'json' && mongoose.connection.readyState === 1) {
    console.log('\n🔄 Exportando datos a JSON antes de cerrar...');
    await exportToJson();
  }
  process.exit(0);
});

const connectDB = async () => {
  try {
    if (DB_MODE === 'json') {
      console.log('🔧 Modo: JSON local (db-export/)');
      await connectLocal();
    } else {
      console.log('🔧 Modo: MongoDB Atlas');
      await connectMongo();
    }
  } catch (err) {
    logger.error('DB connection error', { error: err.message, service: 'DB' });
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  if (DB_MODE !== 'json') {
    logger.warn('MongoDB disconnected', { service: 'MongoDB' });
  }
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error', { error: err.message, service: 'MongoDB' });
});

module.exports = { connectDB, DB_MODE, exportToJson };
