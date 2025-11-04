import { ValidationService } from '../src/validation/validation-service';
import { ModelFramework, DeploymentTarget } from '../src/types/model-types';
import { Logger } from '../src/utils/logger';
import { ErrorHandler, ModelRegistryError, ErrorType } from '../src/utils/error-handler';

describe('Model Registry Components', () => {
  describe('ValidationService', () => {
    let validationService: ValidationService;

    beforeEach(() => {
      validationService = new ValidationService();
    });

    it('should validate a valid register model request', () => {
      const validRequest = {
        modelName: 'fraud-detector',
        version: '1.0.0',
        framework: ModelFramework.SCIKIT_LEARN,
        s3Uri: 's3://ml-models/fraud-detector/model.pkl',
        deploymentTarget: DeploymentTarget.EKS,
        metadata: {
          description: 'Fraud detection model',
          accuracy: 0.95,
        },
      };

      const result = validationService.validateRegisterModelRequest(validRequest);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject invalid model name', () => {
      const invalidRequest = {
        modelName: 'invalid model name!',
        version: '1.0.0',
        framework: ModelFramework.SCIKIT_LEARN,
        s3Uri: 's3://ml-models/fraud-detector/model.pkl',
        deploymentTarget: DeploymentTarget.EKS,
      };

      const result = validationService.validateRegisterModelRequest(invalidRequest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.modelName).toContain('alphanumeric characters');
    });

    it('should reject invalid version format', () => {
      const invalidRequest = {
        modelName: 'fraud-detector',
        version: '1.0',
        framework: ModelFramework.SCIKIT_LEARN,
        s3Uri: 's3://ml-models/fraud-detector/model.pkl',
        deploymentTarget: DeploymentTarget.EKS,
      };

      const result = validationService.validateRegisterModelRequest(invalidRequest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.version).toContain('semantic versioning');
    });

    it('should reject invalid S3 URI', () => {
      const invalidRequest = {
        modelName: 'fraud-detector',
        version: '1.0.0',
        framework: ModelFramework.SCIKIT_LEARN,
        s3Uri: 'invalid-uri',
        deploymentTarget: DeploymentTarget.EKS,
      };

      const result = validationService.validateRegisterModelRequest(invalidRequest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.s3Uri).toContain('s3://bucket/key');
    });
  });

  describe('Logger', () => {
    let logger: Logger;
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      logger = new Logger();
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log info messages with correct format', () => {
      const message = 'Test message';
      const meta = { correlationId: 'test-123' };

      logger.info(message, meta);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"level":"INFO"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Test message"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"correlationId":"test-123"')
      );
    });

    it('should include service name in log entries', () => {
      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"service":"model-registry"')
      );
    });
  });

  describe('ErrorHandler', () => {
    let errorHandler: ErrorHandler;

    beforeEach(() => {
      errorHandler = new ErrorHandler();
    });

    it('should handle ModelRegistryError correctly', () => {
      const error = new ModelRegistryError(
        ErrorType.VALIDATION_ERROR,
        'Invalid input',
        400,
        { field: 'modelName' }
      );

      const result = errorHandler.handleError(error, 'test-correlation-id');

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error.type).toBe('VALIDATION_ERROR');
      expect(JSON.parse(result.body).error.message).toBe('Invalid input');
      expect(JSON.parse(result.body).error.details).toEqual({ field: 'modelName' });
    });

    it('should handle AWS ConditionalCheckFailedException', () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';

      const result = errorHandler.handleError(error, 'test-correlation-id');

      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error.type).toBe('DUPLICATE_RESOURCE');
    });

    it('should handle unknown errors as internal server error', () => {
      const error = new Error('Unknown error');

      const result = errorHandler.handleError(error, 'test-correlation-id');

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error.type).toBe('INTERNAL_ERROR');
    });
  });
});