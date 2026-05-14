const { body, validationResult } = require('express-validator');
const { validators } = require('../../../middleware/validation');

describe('Input Sanitization', () => {
  describe('validators.telefono()', () => {
    it('should sanitize phone by removing spaces and dashes', async () => {
      const req = {
        body: { telefono: '987 654 321' }
      };
      
      await validators.telefono().run(req);
      
      // After sanitization, the phone should be cleaned
      expect(req.body.telefono).toBe('987654321');
    });

    it('should sanitize phone by removing parentheses and dashes', async () => {
      const req = {
        body: { telefono: '(987) 654-321' }
      };
      
      await validators.telefono().run(req);
      
      expect(req.body.telefono).toBe('987654321');
    });

    it('should sanitize phone with mixed non-numeric characters', async () => {
      const req = {
        body: { telefono: '+51 987-654-321' }
      };
      
      await validators.telefono().run(req);
      
      expect(req.body.telefono).toBe('51987654321');
    });

    it('should accept already clean phone number', async () => {
      const req = {
        body: { telefono: '987654321' }
      };
      
      await validators.telefono().run(req);
      const errors = validationResult(req);
      
      expect(errors.isEmpty()).toBe(true);
      expect(req.body.telefono).toBe('987654321');
    });
  });

  describe('validators.email()', () => {
    it('should normalize email to lowercase', async () => {
      const req = {
        body: { email: 'TEST@EXAMPLE.COM' }
      };
      
      await validators.email().run(req);
      
      expect(req.body.email).toBe('test@example.com');
    });

    it('should remove dots from gmail addresses', async () => {
      const req = {
        body: { email: 'test.user@gmail.com' }
      };
      
      await validators.email().run(req);
      
      // normalizeEmail removes dots from gmail addresses
      expect(req.body.email).toBe('testuser@gmail.com');
    });

    it('should trim whitespace from email', async () => {
      const req = {
        body: { email: '  test@example.com  ' }
      };
      
      await validators.email().run(req);
      
      expect(req.body.email).toBe('test@example.com');
    });

    it('should handle email with plus addressing', async () => {
      const req = {
        body: { email: 'test+tag@example.com' }
      };
      
      await validators.email().run(req);
      const errors = validationResult(req);
      
      expect(errors.isEmpty()).toBe(true);
    });
  });

  describe('validators.string()', () => {
    it('should trim whitespace from string', async () => {
      const req = {
        body: { nombre: '  Juan Pérez  ' }
      };
      
      await validators.string('nombre', true, 3, 100).run(req);
      
      expect(req.body.nombre).toBe('Juan Pérez');
    });

    it('should trim leading whitespace', async () => {
      const req = {
        body: { concepto: '   Pago de membresía' }
      };
      
      await validators.string('concepto', false, 1, 255).run(req);
      
      expect(req.body.concepto).toBe('Pago de membresía');
    });

    it('should trim trailing whitespace', async () => {
      const req = {
        body: { notas: 'Cliente preferencial   ' }
      };
      
      await validators.string('notas', false, 1, 255).run(req);
      
      expect(req.body.notas).toBe('Cliente preferencial');
    });

    it('should handle string with only whitespace as empty', async () => {
      const req = {
        body: { notas: '   ' }
      };
      
      await validators.string('notas', false, 1, 255).run(req);
      
      // After trim, empty string should be treated as optional
      expect(req.body.notas).toBe('');
    });
  });

  describe('validators.dni()', () => {
    it('should trim whitespace from DNI', async () => {
      const req = {
        body: { dni: '  12345678  ' }
      };
      
      await validators.dni().run(req);
      const errors = validationResult(req);
      
      expect(errors.isEmpty()).toBe(true);
      expect(req.body.dni).toBe('12345678');
    });

    it('should trim leading whitespace from DNI', async () => {
      const req = {
        body: { dni: '   87654321' }
      };
      
      await validators.dni().run(req);
      const errors = validationResult(req);
      
      expect(errors.isEmpty()).toBe(true);
      expect(req.body.dni).toBe('87654321');
    });
  });

  describe('Combined sanitization', () => {
    it('should sanitize multiple fields in a request', async () => {
      const req = {
        body: {
          nombre: '  Juan Pérez  ',
          email: '  JUAN@EXAMPLE.COM  ',
          telefono: '987 654 321',
          dni: '  12345678  '
        }
      };
      
      await validators.string('nombre', true, 3, 100).run(req);
      await validators.email().run(req);
      await validators.telefono().run(req);
      await validators.dni().run(req);
      
      const errors = validationResult(req);
      
      expect(errors.isEmpty()).toBe(true);
      expect(req.body.nombre).toBe('Juan Pérez');
      expect(req.body.email).toBe('juan@example.com');
      expect(req.body.telefono).toBe('987654321');
      expect(req.body.dni).toBe('12345678');
    });
  });
});
