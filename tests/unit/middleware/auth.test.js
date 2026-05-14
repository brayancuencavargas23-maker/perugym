const jwt = require('jsonwebtoken');
const { verifyToken, protectDeveloperUser, isDeveloperUser, isDeveloperUsername } = require('../../../middleware/auth');
const Usuario = require('../../../models/Usuario');
const { setupTestDB, teardownTestDB, clearDatabase } = require('../../helpers/setup');
const { createUsuario } = require('../../helpers/factories');

describe('Authentication Middleware', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 60000);
  
  afterAll(async () => await teardownTestDB(), 60000);
  afterEach(async () => await clearDatabase());

  describe('verifyToken', () => {
    it('should allow access with valid token from active user', async () => {
      // Arrange: Create active user
      const usuario = await createUsuario({ activo: true });
      const token = jwt.sign(
        { id: usuario._id, role: 'recepcionista' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const req = {
        headers: { authorization: `Bearer ${token}` }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await verifyToken(req, res, next);

      // Assert
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id.toString()).toBe(usuario._id.toString());
    });

    it('should reject with 401 when token is from inactive user', async () => {
      // Arrange: Create inactive user
      const usuario = await createUsuario({ activo: false });
      const token = jwt.sign(
        { id: usuario._id, role: 'recepcionista' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const req = {
        headers: { authorization: `Bearer ${token}` }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await verifyToken(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Usuario inactivo o eliminado' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject with 401 when token is from deleted user', async () => {
      // Arrange: Create user, get token, then delete user
      const usuario = await createUsuario({ activo: true });
      const token = jwt.sign(
        { id: usuario._id, role: 'recepcionista' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      // Delete user
      await Usuario.findByIdAndDelete(usuario._id);

      const req = {
        headers: { authorization: `Bearer ${token}` }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await verifyToken(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Usuario inactivo o eliminado' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow access for developer user', async () => {
      // Arrange: Create developer token
      const token = jwt.sign(
        { id: 'dev', role: 'admin', name: 'Developer' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const req = {
        headers: { authorization: `Bearer ${token}` }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await verifyToken(req, res, next);

      // Assert
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('dev');
    });

    it('should reject with 401 when no token provided', async () => {
      // Arrange
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await verifyToken(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token requerido' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject with 403 when token is invalid', async () => {
      // Arrange
      const req = {
        headers: { authorization: 'Bearer invalid-token' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await verifyToken(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido o expirado' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('protectDeveloperUser', () => {
    it('should prevent modification of developer user by ID', async () => {
      // Arrange
      const middleware = protectDeveloperUser();
      const req = {
        params: { id: 'dev' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'El usuario desarrollador no puede ser modificado o eliminado'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should prevent modification of developer user by username', async () => {
      // Arrange: Set developer username in env
      const originalDevUsername = process.env.DEV_USERNAME;
      process.env.DEV_USERNAME = 'developer';

      // Create user with developer username
      const usuario = await createUsuario({ usuario: 'developer' });

      const middleware = protectDeveloperUser();
      const req = {
        params: { id: usuario._id.toString() }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'El usuario desarrollador no puede ser modificado o eliminado'
      });
      expect(next).not.toHaveBeenCalled();

      // Cleanup
      process.env.DEV_USERNAME = originalDevUsername;
    });

    it('should allow modification of regular users', async () => {
      // Arrange
      const usuario = await createUsuario({ usuario: 'regular_user' });

      const middleware = protectDeveloperUser();
      const req = {
        params: { id: usuario._id.toString() }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next when user not found (let route handler deal with it)', async () => {
      // Arrange
      const mongoose = require('mongoose');
      const nonExistentId = new mongoose.Types.ObjectId();

      const middleware = protectDeveloperUser();
      const req = {
        params: { id: nonExistentId.toString() }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('isDeveloperUser', () => {
    it('should return true for developer user ID', () => {
      expect(isDeveloperUser('dev')).toBe(true);
    });

    it('should return false for regular user ID', () => {
      const mongoose = require('mongoose');
      const regularId = new mongoose.Types.ObjectId();
      expect(isDeveloperUser(regularId.toString())).toBe(false);
    });
  });

  describe('isDeveloperUsername', () => {
    it('should return true when username matches DEV_USERNAME', () => {
      const originalDevUsername = process.env.DEV_USERNAME;
      process.env.DEV_USERNAME = 'developer';

      expect(isDeveloperUsername('developer')).toBe(true);

      process.env.DEV_USERNAME = originalDevUsername;
    });

    it('should return false when username does not match DEV_USERNAME', () => {
      const originalDevUsername = process.env.DEV_USERNAME;
      process.env.DEV_USERNAME = 'developer';

      expect(isDeveloperUsername('regular_user')).toBe(false);

      process.env.DEV_USERNAME = originalDevUsername;
    });

    it('should return false when DEV_USERNAME is not set', () => {
      const originalDevUsername = process.env.DEV_USERNAME;
      delete process.env.DEV_USERNAME;

      const result = isDeveloperUsername('any_user');
      expect(result).toBe(false);

      process.env.DEV_USERNAME = originalDevUsername;
    });
  });
});
