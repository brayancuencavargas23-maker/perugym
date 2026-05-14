# Rollback Guide for Database Migrations

## Migration 001: Add Indexes

### What was changed
- Added unique partial index on `membresias` collection (cliente_id + estado) for active memberships
- Added unique partial index on `cajas` collection (estado) for open cash registers
- Added compound index on `ventas` collection (caja_id + fecha_venta + anulada) for reports

### How to rollback

If you need to remove these indexes, run:

```bash
node scripts/migrations/001_add_indexes.js rollback
```

This will:
1. Remove `idx_cliente_estado_activo` from membresias collection
2. Remove `idx_estado_abierta` from cajas collection
3. Remove `idx_caja_fecha_anulada` from ventas collection

### Manual rollback (if script fails)

Connect to MongoDB and run:

```javascript
// Remove membresias index
db.membresias.dropIndex('idx_cliente_estado_activo');

// Remove cajas index
db.cajas.dropIndex('idx_estado_abierta');

// Remove ventas index
db.ventas.dropIndex('idx_caja_fecha_anulada');
```

### Verification

To verify indexes were removed:

```javascript
// Check membresias indexes
db.membresias.getIndexes();

// Check cajas indexes
db.cajas.getIndexes();

// Check ventas indexes
db.ventas.getIndexes();
```

### Impact of rollback

- **Membresias**: Without the unique partial index, the system may allow duplicate active memberships for the same client
- **Cajas**: Without the unique partial index, the system may allow multiple open cash registers simultaneously
- **Ventas**: Without the compound index, sales reports may be slower

### Re-applying migration

To re-apply the migration after rollback:

```bash
node scripts/migrations/001_add_indexes.js
```
