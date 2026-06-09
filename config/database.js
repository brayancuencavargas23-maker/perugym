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

async function connectLocal() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const memServer = await MongoMemoryServer.create();
  const uri = memServer.getUri();
  await mongoose.connect(uri);
  logger.info('MongoDB Memory connected', { service: 'MongoDB-Memory' });

  if (fs.existsSync(EXPORT_DIR)) {
    const files = fs.readdirSync(EXPORT_DIR).filter(f => f.endsWith('.json'));
    const db = mongoose.connection.db;

    for (const file of files) {
      const collectionName = file.replace('.json', '');
      const filePath = path.join(EXPORT_DIR, file);
      const rawData = fs.readFileSync(filePath, 'utf8');
      let docs = JSON.parse(rawData);

      docs = docs.map(doc => {
        const cleaned = { ...doc };
        if (cleaned._id && typeof cleaned._id === 'string') {
          try {
            cleaned._id = new mongoose.Types.ObjectId(cleaned._id);
          } catch { /* keep as string */ }
        }
        const refFields = ['usuario_id','cliente_id','caja_id','membresia_id','plan_id','producto_id'];
        for (const field of refFields) {
          if (cleaned[field] && typeof cleaned[field] === 'string') {
            try {
              cleaned[field] = new mongoose.Types.ObjectId(cleaned[field]);
            } catch { /* keep as string */ }
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

      if (docs.length > 0) {
        try {
          await db.collection(collectionName).insertMany(docs);
          console.log(`  [JSON] ${collectionName}: ${docs.length} documentos cargados`);
        } catch (err) {
          console.error(`  [JSON] Error cargando ${collectionName}:`, err.message);
        }
      }
    }
    console.log('✅ Base de datos local inicializada desde JSON');
  } else {
    console.warn('⚠️  Carpeta db-export no encontrada:', EXPORT_DIR);
  }
}

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

module.exports = { connectDB, DB_MODE };
