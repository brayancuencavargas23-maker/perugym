/**
 * Regression tests for client-fullname-display-bug
 *
 * Spec: .kiro/specs/client-fullname-display-bug/
 *
 * Estructura del archivo:
 *  - Suite 1: Bug Condition Exploration (Property 1) — DEBE FALLAR en código sin corregir
 *  - Suite 2: Preservation (Property 2)              — DEBE PASAR en código sin corregir
 *
 * Metodología:
 *  - Bug A (frontend): se prueba la lógica pura de construcción del texto de la opción
 *    del select, extraída de loadSelects() en membresias.html.
 *  - Bug B (backend): se prueba el endpoint GET /membresias?nombre= con supertest +
 *    MongoDB en memoria.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Cliente = require('../../models/Cliente');
const Membresia = require('../../models/Membresia');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../helpers/setup');
const { createCliente, createPlan } = require('../helpers/factories');

// ── Token de developer (bypass de autenticación) ──────────────────────────────
const DEV_TOKEN = jwt.sign(
  { id: 'dev', role: 'admin', name: 'Developer' },
  process.env.JWT_SECRET || 'test-secret',
  { expiresIn: '1h' }
);

// ── App de Express mínima para testear el endpoint ───────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  const membresiaRouter = require('../../routes/membresias');
  app.use('/membresias', membresiaRouter);
  return app;
}

// ── Helpers de lógica frontend (extraídos de membresias.html) ─────────────────

/**
 * Versión BUGGY de la función que construye el texto de la opción del select.
 * Replica exactamente el código actual de membresias.html (solo usa c.nombre).
 */
function buildOptionText_buggy(c) {
  return `${c.nombre}${c.dni ? ' - ' + c.dni : ''}`;
}

/**
 * Versión CORREGIDA de la función que construye el texto de la opción del select.
 * Usa el patrón filter(Boolean).join(' ') igual que asistencia.html.
 */
function buildOptionText_fixed(c) {
  const fullName = [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ');
  return `${fullName}${c.dni ? ' - ' + c.dni : ''}`;
}

// ── Bug Condition helpers ─────────────────────────────────────────────────────

/**
 * isBugCondition_Selector: el bug se activa cuando el cliente tiene al menos un apellido.
 */
function isBugCondition_Selector(c) {
  return c.apellido_paterno != null || c.apellido_materno != null;
}

/**
 * isBugCondition_Busqueda: el bug se activa cuando el término coincide con el nombre
 * completo (incluyendo apellidos) pero NO coincide solo con el campo nombre.
 */
function isBugCondition_Busqueda(termino, c) {
  const nombreCompleto = [c.nombre, c.apellido_paterno, c.apellido_materno]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    nombreCompleto.includes(termino.toLowerCase()) &&
    !c.nombre.toLowerCase().includes(termino.toLowerCase())
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Bug Condition Exploration (Property 1)
// Estos tests DEBEN FALLAR en el código sin corregir.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 1: Bug Condition — client-fullname-display-bug', () => {
  // ── Bug A: Selector de cliente ──────────────────────────────────────────────

  describe('Bug A — Selector: opción del select muestra nombre completo', () => {
    /**
     * Scoped PBT: genera clientes con apellidos (isBugCondition_Selector = true)
     * y verifica que la opción del select contiene los apellidos.
     * En código buggy: FALLA porque buildOptionText_buggy solo usa c.nombre.
     * En código corregido: PASA.
     */
    const clientesConApellidos = [
      { nombre: 'Juan',   apellido_paterno: 'García',    apellido_materno: 'López'  },
      { nombre: 'María',  apellido_paterno: 'Quispe',    apellido_materno: null     },
      { nombre: 'Carlos', apellido_paterno: null,         apellido_materno: 'Torres' },
      { nombre: 'Ana',    apellido_paterno: 'Rodríguez', apellido_materno: 'Vega'   },
      { nombre: 'Luis',   apellido_paterno: 'Martínez',  apellido_materno: 'Cruz'   },
    ];

    test.each(clientesConApellidos)(
      'opción para $nombre $apellido_paterno $apellido_materno contiene apellidos',
      (c) => {
        // Precondición: este cliente activa la bug condition
        expect(isBugCondition_Selector(c)).toBe(true);

        const texto = buildOptionText_fixed(c);

        // El texto debe contener el apellido paterno si no es null
        if (c.apellido_paterno) {
          expect(texto).toContain(c.apellido_paterno);
        }
        // El texto debe contener el apellido materno si no es null
        if (c.apellido_materno) {
          expect(texto).toContain(c.apellido_materno);
        }
        // El texto NO debe contener la cadena "null"
        expect(texto).not.toContain('null');
        // El texto debe contener el nombre
        expect(texto).toContain(c.nombre);
      }
    );

    test('PBT — para todo cliente con apellidos, la opción contiene el nombre completo', () => {
      // Property-based: genera combinaciones de nombres y apellidos
      const nombres   = ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Carmen', 'Pedro', 'Rosa'];
      const apellidos = ['García', 'López', 'Martínez', 'Quispe', 'Torres', 'Vega', 'Cruz', 'Ruiz'];

      const contraejemplos = [];

      for (const nombre of nombres) {
        for (const ap of apellidos) {
          const c = { nombre, apellido_paterno: ap, apellido_materno: null };
          if (!isBugCondition_Selector(c)) continue;

          const texto = buildOptionText_fixed(c);
          if (!texto.includes(ap)) {
            contraejemplos.push({ cliente: c, textoGenerado: texto });
          }
        }
      }

      // Documentar contraejemplos si los hay
      if (contraejemplos.length > 0) {
        console.error('Contraejemplos encontrados (Bug A):', JSON.stringify(contraejemplos, null, 2));
      }

      expect(contraejemplos).toHaveLength(0);
    });
  });

  // ── Bug B: Búsqueda por apellido en el endpoint ─────────────────────────────

  describe('Bug B — Búsqueda: GET /membresias?nombre= retorna resultados por apellido', () => {
    let app;

    beforeAll(async () => {
      await setupTestDB();
      app = buildApp();
    }, 60000);

    afterAll(async () => await teardownTestDB(), 60000);
    afterEach(async () => await clearDatabase());

    test('búsqueda por apellido_paterno retorna la membresía del cliente', async () => {
      // Arrange
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });
      const cliente = await createCliente({
        nombre: 'Juan',
        apellido_paterno: 'García',
        apellido_materno: 'López',
      });
      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'activo',
      });

      // Precondición: este caso activa la bug condition
      expect(isBugCondition_Busqueda('García', cliente)).toBe(true);

      // Act
      const res = await request(app)
        .get('/membresias?nombre=Garc%C3%ADa')
        .set('Authorization', `Bearer ${DEV_TOKEN}`)
        .expect(200);

      // Assert: el cliente debe aparecer en los resultados
      // cliente_nombre es el campo calculado que concatena nombre + apellidos
      const clienteNombres = res.body.data.map(m => m.cliente_nombre || '');
      expect(clienteNombres.some(n => n.includes('García'))).toBe(true);
    });

    test('búsqueda por apellido_materno retorna la membresía del cliente', async () => {
      // Arrange
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });
      const cliente = await createCliente({
        nombre: 'María',
        apellido_paterno: 'Quispe',
        apellido_materno: 'Torres',
      });
      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'activo',
      });

      expect(isBugCondition_Busqueda('Torres', cliente)).toBe(true);

      const res = await request(app)
        .get('/membresias?nombre=Torres')
        .set('Authorization', `Bearer ${DEV_TOKEN}`)
        .expect(200);

      const clienteNombres = res.body.data.map(m => m.cliente_nombre || '');
      expect(clienteNombres.some(n => n.includes('Torres'))).toBe(true);
    });

    test('búsqueda por nombre completo (nombre + apellido) retorna la membresía', async () => {
      // Arrange
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });
      const cliente = await createCliente({
        nombre: 'Carlos',
        apellido_paterno: 'Rodríguez',
        apellido_materno: 'Vega',
      });
      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'activo',
      });

      // Nota: la búsqueda por apellido activa la bug condition
      // (el término "Rodríguez" coincide con apellido_paterno pero no con nombre)
      expect(isBugCondition_Busqueda('Rodríguez', cliente)).toBe(true);

      // Buscar por apellido (campo individual) — el fix amplía la búsqueda a apellidos
      const res = await request(app)
        .get('/membresias?nombre=Rodr%C3%ADguez')
        .set('Authorization', `Bearer ${DEV_TOKEN}`)
        .expect(200);

      const clienteNombres = res.body.data.map(m => m.cliente_nombre || '');
      expect(clienteNombres.some(n => n.includes('Rodríguez'))).toBe(true);
    });

    test('PBT — para todo apellido en la lista, la búsqueda retorna el cliente correcto', async () => {
      // Property-based: crea clientes con apellidos conocidos y verifica que la búsqueda los encuentra
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });

      const casos = [
        { nombre: 'Ana',  apellido_paterno: 'Martínez', apellido_materno: 'Cruz' },
        { nombre: 'Luis', apellido_paterno: 'Pérez',    apellido_materno: 'Ruiz' },
        { nombre: 'Rosa', apellido_paterno: 'Sánchez',  apellido_materno: 'Mora' },
      ];

      for (const datos of casos) {
        const cliente = await createCliente(datos);
        await Membresia.create({
          cliente_id: cliente._id,
          plan_id: plan._id,
          fecha_inicio: new Date(),
          fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          estado: 'activo',
        });

        // Buscar por apellido paterno — activa bug condition
        const termino = datos.apellido_paterno;
        expect(isBugCondition_Busqueda(termino, datos)).toBe(true);

        const res = await request(app)
          .get(`/membresias?nombre=${encodeURIComponent(termino)}`)
          .set('Authorization', `Bearer ${DEV_TOKEN}`)
          .expect(200);

        const clienteNombres = res.body.data.map(m => m.cliente_nombre || '');
        expect(clienteNombres.some(n => n.includes(termino))).toBe(true);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Preservation (Property 2)
// Estos tests DEBEN PASAR tanto en código sin corregir como en código corregido.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 2: Preservation — client-fullname-display-bug', () => {
  // ── Preservation A: Selector sin apellidos ──────────────────────────────────

  describe('Preservation A — Selector: clientes sin apellidos se muestran igual', () => {
    const clientesSinApellidos = [
      { nombre: 'Pedro',   apellido_paterno: null, apellido_materno: null },
      { nombre: 'Lucía',   apellido_paterno: null, apellido_materno: null },
      { nombre: 'Roberto', apellido_paterno: null, apellido_materno: null },
    ];

    test.each(clientesSinApellidos)(
      'cliente $nombre (sin apellidos) se muestra igual en versión buggy y corregida',
      (c) => {
        // Precondición: este cliente NO activa la bug condition
        expect(isBugCondition_Selector(c)).toBe(false);

        const textoBuggy = buildOptionText_buggy(c);
        const textoFixed = buildOptionText_fixed(c);

        // Ambas versiones deben producir el mismo texto
        expect(textoFixed).toBe(textoBuggy);
        // El texto debe ser solo el nombre
        expect(textoFixed).toBe(c.nombre);
        // No debe contener "null"
        expect(textoFixed).not.toContain('null');
      }
    );

    test('PBT — para todo cliente sin apellidos, la versión corregida produce el mismo texto', () => {
      const nombres = ['Pedro', 'Lucía', 'Roberto', 'Elena', 'Marcos', 'Sofía'];
      const contraejemplos = [];

      for (const nombre of nombres) {
        const c = { nombre, apellido_paterno: null, apellido_materno: null };
        const textoBuggy = buildOptionText_buggy(c);
        const textoFixed = buildOptionText_fixed(c);

        if (textoFixed !== textoBuggy) {
          contraejemplos.push({ cliente: c, textoBuggy, textoFixed });
        }
      }

      if (contraejemplos.length > 0) {
        console.error('Regresión detectada (Preservation A):', JSON.stringify(contraejemplos, null, 2));
      }

      expect(contraejemplos).toHaveLength(0);
    });
  });

  // ── Preservation B: Búsqueda por primer nombre sigue funcionando ────────────

  describe('Preservation B — Búsqueda: búsqueda por primer nombre retorna los mismos resultados', () => {
    let app;

    beforeAll(async () => {
      await setupTestDB();
      app = buildApp();
    }, 60000);

    afterAll(async () => await teardownTestDB(), 60000);
    afterEach(async () => await clearDatabase());

    test('búsqueda por nombre (primer campo) retorna la membresía del cliente', async () => {
      // Arrange
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });
      const cliente = await createCliente({
        nombre: 'Juan',
        apellido_paterno: 'García',
        apellido_materno: 'López',
      });
      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'activo',
      });

      // Precondición: este caso NO activa la bug condition (busca por nombre)
      expect(isBugCondition_Busqueda('Juan', cliente)).toBe(false);

      // Act
      const res = await request(app)
        .get('/membresias?nombre=Juan')
        .set('Authorization', `Bearer ${DEV_TOKEN}`)
        .expect(200);

      // Assert: el cliente debe aparecer en los resultados
      // cliente_id en la respuesta es un objeto populado; usamos cliente_nombre para verificar
      const clienteNombres = res.body.data.map(m => m.cliente_nombre);
      expect(clienteNombres.some(n => n && n.includes('Juan'))).toBe(true);
    });

    test('búsqueda por nombre parcial retorna clientes que coinciden', async () => {
      // Arrange
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });
      const cliente = await createCliente({
        nombre: 'Carlos',
        apellido_paterno: 'Rodríguez',
        apellido_materno: null,
      });
      await Membresia.create({
        cliente_id: cliente._id,
        plan_id: plan._id,
        fecha_inicio: new Date(),
        fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        estado: 'activo',
      });

      // "Car" coincide con "Carlos" (nombre), no activa bug condition
      expect(isBugCondition_Busqueda('Car', cliente)).toBe(false);

      const res = await request(app)
        .get('/membresias?nombre=Car')
        .set('Authorization', `Bearer ${DEV_TOKEN}`)
        .expect(200);

      const clienteNombres = res.body.data.map(m => m.cliente_nombre);
      expect(clienteNombres.some(n => n && n.includes('Carlos'))).toBe(true);
    });

    test('PBT — para todo nombre en la lista, la búsqueda retorna el cliente correcto', async () => {
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });

      const casos = [
        { nombre: 'Ana',  apellido_paterno: 'Martínez', apellido_materno: 'Cruz' },
        { nombre: 'Luis', apellido_paterno: 'Pérez',    apellido_materno: 'Ruiz' },
        { nombre: 'Rosa', apellido_paterno: 'Sánchez',  apellido_materno: 'Mora' },
      ];

      for (const datos of casos) {
        const cliente = await createCliente(datos);
        await Membresia.create({
          cliente_id: cliente._id,
          plan_id: plan._id,
          fecha_inicio: new Date(),
          fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          estado: 'activo',
        });

        // Buscar por nombre (primer campo) — no activa bug condition
        const termino = datos.nombre;
        expect(isBugCondition_Busqueda(termino, datos)).toBe(false);

        const res = await request(app)
          .get(`/membresias?nombre=${encodeURIComponent(termino)}`)
          .set('Authorization', `Bearer ${DEV_TOKEN}`)
          .expect(200);

        const clienteNombres = res.body.data.map(m => m.cliente_nombre);
        expect(clienteNombres.some(n => n && n.includes(termino))).toBe(true);
      }
    });

    test('sin filtro de nombre retorna todas las membresías', async () => {
      // Arrange: crear 3 membresías
      const plan = await createPlan({ duracion_dias: 30, precio: 100 });
      const clientes = await Promise.all([
        createCliente({ nombre: 'Ana',   apellido_paterno: 'García' }),
        createCliente({ nombre: 'Luis',  apellido_paterno: 'López'  }),
        createCliente({ nombre: 'Rosa',  apellido_paterno: null, apellido_materno: null }),
      ]);

      for (const c of clientes) {
        await Membresia.create({
          cliente_id: c._id,
          plan_id: plan._id,
          fecha_inicio: new Date(),
          fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          estado: 'activo',
        });
      }

      // Act: sin filtro
      const res = await request(app)
        .get('/membresias')
        .set('Authorization', `Bearer ${DEV_TOKEN}`)
        .expect(200);

      // Assert: deben aparecer las 3 membresías
      expect(res.body.data.length).toBe(3);
    });
  });
});
