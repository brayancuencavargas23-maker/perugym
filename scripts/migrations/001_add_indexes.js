const mongoose = require('mongoose');
require('dotenv').config();

/**
 * Migration script to add indexes to MongoDB collections
 * This script adds:
 * 1. Unique partial index on Membresia (cliente_id + estado) for active memberships
 * 2. Unique partial index on Caja (estado) for open cash registers
 * 3. Compound index on Venta (caja_id + fecha_venta + anulada) for reports
 */
async function migrate() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    console.log('\n📊 Adding indexes...\n');

    // 1. Unique partial index for active memberships
    console.log('1️⃣  Creating unique partial index on membresias (cliente_id + estado)...');
    try {
      await db.collection('membresias').createIndex(
        { cliente_id: 1, estado: 1 },
        {
          unique: true,
          partialFilterExpression: { estado: 'activo' },
          background: true,
          name: 'idx_cliente_estado_activo'
        }
      );
      console.log('   ✅ Index created: idx_cliente_estado_activo');
    } catch (error) {
      if (error.code === 85) {
        console.log('   ⚠️  Index already exists: idx_cliente_estado_activo');
      } else {
        throw error;
      }
    }

    // 2. Unique partial index for open cash registers
    console.log('\n2️⃣  Creating unique partial index on cajas (estado)...');
    try {
      await db.collection('cajas').createIndex(
        { estado: 1 },
        {
          unique: true,
          partialFilterExpression: { estado: 'abierta' },
          background: true,
          name: 'idx_estado_abierta'
        }
      );
      console.log('   ✅ Index created: idx_estado_abierta');
    } catch (error) {
      if (error.code === 85) {
        console.log('   ⚠️  Index already exists: idx_estado_abierta');
      } else {
        throw error;
      }
    }

    // 3. Compound index for sales reports
    console.log('\n3️⃣  Creating compound index on ventas (caja_id + fecha_venta + anulada)...');
    try {
      await db.collection('ventas').createIndex(
        { caja_id: 1, fecha_venta: -1, anulada: 1 },
        {
          background: true,
          name: 'idx_caja_fecha_anulada'
        }
      );
      console.log('   ✅ Index created: idx_caja_fecha_anulada');
    } catch (error) {
      if (error.code === 85) {
        console.log('   ⚠️  Index already exists: idx_caja_fecha_anulada');
      } else {
        throw error;
      }
    }

    console.log('\n✅ All indexes created successfully!\n');

    // Verify indexes
    console.log('🔍 Verifying indexes...\n');
    
    const membresiaIndexes = await db.collection('membresias').indexes();
    console.log('Membresias indexes:', membresiaIndexes.map(i => i.name).join(', '));
    
    const cajaIndexes = await db.collection('cajas').indexes();
    console.log('Cajas indexes:', cajaIndexes.map(i => i.name).join(', '));
    
    const ventaIndexes = await db.collection('ventas').indexes();
    console.log('Ventas indexes:', ventaIndexes.map(i => i.name).join(', '));

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Rollback function (to remove indexes if needed)
async function rollback() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    console.log('\n📊 Removing indexes...\n');

    // Remove indexes
    try {
      await db.collection('membresias').dropIndex('idx_cliente_estado_activo');
      console.log('✅ Removed index: idx_cliente_estado_activo');
    } catch (error) {
      console.log('⚠️  Index not found: idx_cliente_estado_activo');
    }

    try {
      await db.collection('cajas').dropIndex('idx_estado_abierta');
      console.log('✅ Removed index: idx_estado_abierta');
    } catch (error) {
      console.log('⚠️  Index not found: idx_estado_abierta');
    }

    try {
      await db.collection('ventas').dropIndex('idx_caja_fecha_anulada');
      console.log('✅ Removed index: idx_caja_fecha_anulada');
    } catch (error) {
      console.log('⚠️  Index not found: idx_caja_fecha_anulada');
    }

    console.log('\n✅ Rollback completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Rollback failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run migration or rollback based on command line argument
const command = process.argv[2];

if (command === 'rollback') {
  rollback();
} else {
  migrate();
}
