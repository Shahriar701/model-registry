import { ValidationService } from '../../validation/validation-service';
import { ModelFramework, DeploymentTarget, ModelStatus } from '../../types/model-types';

describe('ValidationService', () => {
  let validationService: ValidationService;

  beforeEach(() => {
    validationService = new ValidationService();
  });

  describe('validateRegisterModelRequest', () => {
    const validRequest = {
      modelName: 'test-model',
      version: '1.0.0',
      framework: ModelFramework.SCIKIT_LEARN,
      s3Uri: 's3://test-bucket/test-model/v1.0.0/model.pkl',
      deploymentTarget: DeploymentTarget.EKS,
      metadata: {
        description: 'Test model',
        accuracy: 0.95,
        features: ['feature1', 'feature2'],
        tags: ['ml', 'classification'],
      },
    };

    it('should validate a valid request', () => {
      const result = validationService.validateRegisterModelRequest(validRequest);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject request with missing model name', () => {
      const invalidRequest = { ...validRequest, modelName: '' };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.modelName).toBeDefined();
    });

    it('should reject request with invalid model name characters', () => {
      const invalidRequest = { ...validRequest, modelName: 'test model!' };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.modelName).toBe('Model name can only contain alphanumeric characters, hyphens, and underscores');
    });

    it('should reject request with model name too long', () => {
      const invalidRequest = { ...validRequest, modelName: 'a'.repeat(101) };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.modelName).toBe('Model name must be less than 100 characters');
    });

    it('should reject request with invalid version format', () => {
      const invalidRequest = { ...validRequest, version: '1.0' };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.version).toBe('Version must follow semantic versioning format (e.g., 1.0.0)');
    });

    it('should reject request with invalid framework', () => {
      const invalidRequest = { ...validRequest, framework: 'invalid-framework' as ModelFramework };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.framework).toBeDefined();
    });

    it('should reject request with invalid S3 URI format', () => {
      const invalidRequest = { ...validRequest, s3Uri: 'invalid-uri' };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.s3Uri).toBe('S3 URI must be in format s3://bucket/key');
    });

    it('should reject request with invalid deployment target', () => {
      const invalidRequest = { ...validRequest, deploymentTarget: 'invalid-target' as DeploymentTarget };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.deploymentTarget).toBeDefined();
    });

    it('should validate request with optional metadata', () => {
      const requestWithoutMetadata = { ...validRequest };
      delete (requestWithoutMetadata as any).metadata;
      
      const result = validationService.validateRegisterModelRequest(requestWithoutMetadata);
      expect(result.isValid).toBe(true);
    });

    it('should reject request with invalid metadata accuracy', () => {
      const invalidRequest = {
        ...validRequest,
        metadata: { ...validRequest.metadata, accuracy: 1.5 },
      };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.['metadata.accuracy']).toBeDefined();
    });

    it('should reject request with too many features', () => {
      const invalidRequest = {
        ...validRequest,
        metadata: { 
          ...validRequest.metadata, 
          features: Array(101).fill('feature'),
        },
      };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.['metadata.features']).toBeDefined();
    });

    it('should reject request with too many tags', () => {
      const invalidRequest = {
        ...validRequest,
        metadata: { 
          ...validRequest.metadata, 
          tags: Array(21).fill('tag'),
        },
      };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.['metadata.tags']).toBeDefined();
    });

    it('should reject request with description too long', () => {
      const invalidRequest = {
        ...validRequest,
        metadata: { 
          ...validRequest.metadata, 
          description: 'a'.repeat(1001),
        },
      };
      const result = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.['metadata.description']).toBeDefined();
    });
  });

  describe('validateUpdateModelMetadata', () => {
    const validMetadata = {
      description: 'Updated description',
      accuracy: 0.98,
      features: ['feature1', 'feature2', 'feature3'],
      tags: ['ml', 'updated'],
    };

    it('should validate valid metadata', () => {
      const result = validationService.validateUpdateModelMetadata(validMetadata);
      expect(result.isValid).toBe(true);
    });

    it('should reject metadata with invalid accuracy', () => {
      const invalidMetadata = { ...validMetadata, accuracy: -0.1 };
      const result = validationService.validateUpdateModelMetadata(invalidMetadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors?.accuracy).toBeDefined();
    });

    it('should validate empty metadata object', () => {
      const result = validationService.validateUpdateModelMetadata({});
      expect(result.isValid).toBe(true);
    });
  });

  describe('validateModelId', () => {
    it('should validate valid model ID', () => {
      const result = validationService.validateModelId('test-model-123');
      expect(result.isValid).toBe(true);
    });

    it('should reject empty model ID', () => {
      const result = validationService.validateModelId('');
      expect(result.isValid).toBe(false);
      expect(result.errors?.modelId).toBe('Model ID is required');
    });

    it('should reject model ID with uppercase letters', () => {
      const result = validationService.validateModelId('Test-Model');
      expect(result.isValid).toBe(false);
      expect(result.errors?.modelId).toBe('Model ID can only contain lowercase letters, numbers, and hyphens');
    });

    it('should reject model ID with special characters', () => {
      const result = validationService.validateModelId('test_model!');
      expect(result.isValid).toBe(false);
      expect(result.errors?.modelId).toBe('Model ID can only contain lowercase letters, numbers, and hyphens');
    });

    it('should reject model ID that is too long', () => {
      const result = validationService.validateModelId('a'.repeat(101));
      expect(result.isValid).toBe(false);
      expect(result.errors?.modelId).toBe('Model ID must be less than 100 characters');
    });
  });

  describe('validateVersion', () => {
    it('should validate valid semantic version', () => {
      const result = validationService.validateVersion('1.2.3');
      expect(result.isValid).toBe(true);
    });

    it('should reject empty version', () => {
      const result = validationService.validateVersion('');
      expect(result.isValid).toBe(false);
      expect(result.errors?.version).toBe('Version is required');
    });

    it('should reject invalid version format', () => {
      const result = validationService.validateVersion('1.2');
      expect(result.isValid).toBe(false);
      expect(result.errors?.version).toBe('Version must follow semantic versioning format (e.g., 1.0.0)');
    });

    it('should reject version with non-numeric parts', () => {
      const result = validationService.validateVersion('1.2.beta');
      expect(result.isValid).toBe(false);
      expect(result.errors?.version).toBe('Version must follow semantic versioning format (e.g., 1.0.0)');
    });
  });

  describe('validateTeamId', () => {
    it('should validate valid team ID', () => {
      const result = validationService.validateTeamId('data-science-team');
      expect(result.isValid).toBe(true);
    });

    it('should reject empty team ID', () => {
      const result = validationService.validateTeamId('');
      expect(result.isValid).toBe(false);
      expect(result.errors?.teamId).toBe('Team ID is required');
    });

    it('should reject team ID with special characters', () => {
      const result = validationService.validateTeamId('team@company.com');
      expect(result.isValid).toBe(false);
      expect(result.errors?.teamId).toBe('Team ID can only contain alphanumeric characters, hyphens, and underscores');
    });

    it('should reject team ID that is too long', () => {
      const result = validationService.validateTeamId('a'.repeat(51));
      expect(result.isValid).toBe(false);
      expect(result.errors?.teamId).toBe('Team ID must be less than 50 characters');
    });
  });

  describe('validatePaginationParams', () => {
    it('should validate valid pagination params', () => {
      // Create a valid base64 token
      const validToken = Buffer.from(JSON.stringify({ PK: 'MODEL#test', SK: 'VERSION#1.0.0' })).toString('base64');
      const result = validationService.validatePaginationParams('50', validToken);
      expect(result.isValid).toBe(true);
    });

    it('should validate undefined params', () => {
      const result = validationService.validatePaginationParams();
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid limit', () => {
      const result = validationService.validatePaginationParams('0');
      expect(result.isValid).toBe(false);
      expect(result.errors?.limit).toBe('Limit must be a number between 1 and 100');
    });

    it('should reject limit too high', () => {
      const result = validationService.validatePaginationParams('101');
      expect(result.isValid).toBe(false);
      expect(result.errors?.limit).toBe('Limit must be a number between 1 and 100');
    });

    it('should reject non-numeric limit', () => {
      const result = validationService.validatePaginationParams('abc');
      expect(result.isValid).toBe(false);
      expect(result.errors?.limit).toBe('Limit must be a number between 1 and 100');
    });

    it('should reject invalid next token', () => {
      const result = validationService.validatePaginationParams('50', 'invalid-token');
      expect(result.isValid).toBe(false);
      expect(result.errors?.nextToken).toBe('Invalid next token format');
    });
  });

  describe('validateDeploymentTarget', () => {
    it('should validate valid deployment target', () => {
      const result = validationService.validateDeploymentTarget(DeploymentTarget.EKS);
      expect(result.isValid).toBe(true);
    });

    it('should validate undefined deployment target', () => {
      const result = validationService.validateDeploymentTarget();
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid deployment target', () => {
      const result = validationService.validateDeploymentTarget('INVALID');
      expect(result.isValid).toBe(false);
      expect(result.errors?.deploymentTarget).toContain('Deployment target must be one of:');
    });
  });

  describe('validateFramework', () => {
    it('should validate valid framework', () => {
      const result = validationService.validateFramework(ModelFramework.TENSORFLOW);
      expect(result.isValid).toBe(true);
    });

    it('should validate undefined framework', () => {
      const result = validationService.validateFramework();
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid framework', () => {
      const result = validationService.validateFramework('INVALID');
      expect(result.isValid).toBe(false);
      expect(result.errors?.framework).toContain('Framework must be one of:');
    });
  });

  describe('validateModelStatus', () => {
    it('should validate valid status', () => {
      const result = validationService.validateModelStatus(ModelStatus.DEPLOYED);
      expect(result.isValid).toBe(true);
    });

    it('should validate undefined status', () => {
      const result = validationService.validateModelStatus();
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = validationService.validateModelStatus('INVALID');
      expect(result.isValid).toBe(false);
      expect(result.errors?.status).toContain('Status must be one of:');
    });
  });

  describe('validateNamePattern', () => {
    it('should validate valid name pattern', () => {
      const result = validationService.validateNamePattern('test-model');
      expect(result.isValid).toBe(true);
    });

    it('should validate undefined name pattern', () => {
      const result = validationService.validateNamePattern();
      expect(result.isValid).toBe(true);
    });

    it('should reject name pattern that is too long', () => {
      const result = validationService.validateNamePattern('a'.repeat(101));
      expect(result.isValid).toBe(false);
      expect(result.errors?.namePattern).toBe('Name pattern must be less than 100 characters');
    });
  });
});