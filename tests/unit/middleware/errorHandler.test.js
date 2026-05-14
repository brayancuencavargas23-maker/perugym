const { errorHandler, asyncHandler } = require('../../../middleware/errorHandler');
const {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError
} = require('../../../middleware/errors/ErrorTypes');

describe('Error Handler Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      method: 'GET',
      path: '/test',
      query: {},
      body: {},
      ip: '127.0.0.1'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  describe('errorHandler', () => {
    it('should handle ValidationError with 400 status', () => {
      const error = new ValidationError('Validation failed');
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Validation failed'
      });
    });

    it('should handle NotFoundError with 404 status', () => {
      const error = new NotFoundError('Usuario');
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Usuario no encontrado.'
      });
    });

    it('should handle ConflictError with 409 status', () => {
      const error = new ConflictError('Resource already exists');
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Resource already exists'
      });
    });

    it('should handle UnauthorizedError with 401 status', () => {
      const error = new UnauthorizedError();
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No autorizado'
      });
    });

    it('should handle Mongoose ValidationError', () => {
      const error = {
        name: 'ValidationError',
        errors: {
          field1: { message: 'Field is required' }
        }
      };
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Field is required'
      });
    });

    it('should handle Mongoose CastError', () => {
      const error = {
        name: 'CastError',
        path: 'id'
      };
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'id inválido.'
      });
    });

    it('should handle MongoDB duplicate key error', () => {
      const error = {
        code: 11000,
        keyPattern: { email: 1 }
      };
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Ya existe un registro con ese email.'
      });
    });

    it('should sanitize sensitive fields in logs', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      req.body = { password: 'secret123', token: 'abc123' };
      
      const error = new AppError('Test error');
      errorHandler(error, req, res, next);

      // The logger now outputs a single JSON string as the first argument
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.body.password).toBe('[REDACTED]');
      expect(loggedData.body.token).toBe('[REDACTED]');

      consoleSpy.mockRestore();
    });
  });

  describe('asyncHandler', () => {
    it('should catch async errors and pass to next', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        throw new Error('Async error');
      });

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('Async error');
    });

    it('should not call next if no error occurs', async () => {
      const handler = asyncHandler(async (req, res, next) => {
        res.json({ success: true });
      });

      await handler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
