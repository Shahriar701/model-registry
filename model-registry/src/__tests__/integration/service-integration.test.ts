import { ValidationService } from '../../validation/validation-service';
import { VersionUtils } from '../../utils/version-utils';
import { ModelFramework, DeploymentTarget, RegisterModelRequest } from '../../types/model-types';

describe('Service Integration Tests', () => {
  let validationService: ValidationService;

  beforeEach(() => {
    validationService = new ValidationService();
  });

  describe('Model Registration Validation Integration', () => {
    const validRequest: RegisterModelRequest = {
      modelName: 'fraud-detection-model',
      version: '1.0.0',
      framework: ModelFramework.SCIKIT_LEARN,
      s3Uri: 's3://ml-models/fraud-detection/v1.0.0/model.pkl',
      deploymentTarget: DeploymentTarget.EKS,
      teamId: 'data-science-team',
      metadata: {
        description: 'ML model for detecting fraudulent transactions',
        accuracy: 0.95,
        features: ['transaction_amount', 'user_age', 'merchant_category'],
        tags: ['fraud-detection', 'classification'],
      },
    };

    it('should validate complete model registration workflow', () => {
      // Step 1: Validate the request
      const validationResult = validationService.validateRegisterModelRequest(validRequest);
      expect(validationResult.isValid).toBe(true);

      // Step 2: Validate individual components
      const modelIdValidation = validationService.validateModelId('fraud-detection-model');
      expect(modelIdValidation.isValid).toBe(true);

      const versionValidation = validationService.validateVersion('1.0.0');
      expect(versionValidation.isValid).toBe(true);

      const teamIdValidation = validationService.validateTeamId('data-science-team');
      expect(teamIdValidation.isValid).toBe(true);

      // Step 3: Validate version semantics
      expect(VersionUtils.isValidSemanticVersion('1.0.0')).toBe(true);
      expect(VersionUtils.parseVersion('1.0.0')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
      });
    });

    it('should handle invalid model registration data', () => {
      const invalidRequest = {
        ...validRequest,
        modelName: '', // Invalid
        version: 'invalid-version', // Invalid
        s3Uri: 'invalid-uri', // Invalid
      };

      const validationResult = validationService.validateRegisterModelRequest(invalidRequest);
      expect(validationResult.isValid).toBe(false);
      expect(validationResult.errors).toBeDefined();
      expect(Object.keys(validationResult.errors!)).toHaveLength(3);
    });

    it('should validate model versioning scenarios', () => {
      const versions = ['1.0.0', '1.1.0', '1.0.1', '2.0.0'];
      
      // Validate all versions
      versions.forEach(version => {
        const validation = validationService.validateVersion(version);
        expect(validation.isValid).toBe(true);
      });

      // Test version comparison
      expect(VersionUtils.compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(VersionUtils.compareVersions('1.0.1', '1.0.0')).toBe(1);
      expect(VersionUtils.compareVersions('2.0.0', '1.9.9')).toBe(1);

      // Test latest version detection
      const latestVersion = VersionUtils.getLatestVersion(versions);
      expect(latestVersion).toBe('2.0.0');
    });
  });

  describe('Model Metadata Validation Integration', () => {
    it('should validate comprehensive metadata', () => {
      const metadata = {
        description: 'Comprehensive ML model for fraud detection using ensemble methods',
        accuracy: 0.95,
        features: ['transaction_amount', 'user_age', 'merchant_category', 'time_of_day'],
        modelSize: 1024000,
        trainingDataset: 'fraud_training_data_v1.csv',
        tags: ['fraud-detection', 'classification', 'ensemble', 'production'],
        hyperparameters: {
          n_estimators: 100,
          max_depth: 10,
          learning_rate: 0.1,
        },
      };

      const validationResult = validationService.validateUpdateModelMetadata(metadata);
      expect(validationResult.isValid).toBe(true);
    });

    it('should reject invalid metadata', () => {
      const invalidMetadata = {
        description: 'a'.repeat(1001), // Too long
        accuracy: 1.5, // Invalid range
        features: Array(101).fill('feature'), // Too many
        tags: Array(21).fill('tag'), // Too many
      };

      const validationResult = validationService.validateUpdateModelMetadata(invalidMetadata);
      expect(validationResult.isValid).toBe(false);
      expect(validationResult.errors).toBeDefined();
      expect(Object.keys(validationResult.errors!)).toHaveLength(4);
    });
  });

  describe('Query Parameter Validation Integration', () => {
    it('should validate model listing parameters', () => {
      // Valid parameters
      const validParams = [
        validationService.validatePaginationParams('50'),
        validationService.validateDeploymentTarget(DeploymentTarget.EKS),
        validationService.validateFramework(ModelFramework.TENSORFLOW),
        validationService.validateNamePattern('fraud-detection'),
      ];

      validParams.forEach(result => {
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject invalid query parameters', () => {
      // Invalid parameters
      const invalidResults = [
        validationService.validatePaginationParams('0'), // Invalid limit
        validationService.validateDeploymentTarget('INVALID'), // Invalid target
        validationService.validateFramework('INVALID'), // Invalid framework
        validationService.validateNamePattern('a'.repeat(101)), // Too long
      ];

      invalidResults.forEach(result => {
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
      });
    });
  });

  describe('Cross-Service Validation Integration', () => {
    it('should validate model registration with version progression', () => {
      const baseModel = {
        modelName: 'recommendation-engine',
        framework: ModelFramework.TENSORFLOW,
        s3Uri: 's3://ml-models/recommendation/model.pb',
        deploymentTarget: DeploymentTarget.LAMBDA,
        teamId: 'ml-team',
        metadata: {
          description: 'Recommendation engine model',
          accuracy: 0.87,
        },
      };

      // Test version progression
      const versions = ['1.0.0', '1.0.1', '1.1.0', '2.0.0'];
      
      versions.forEach(version => {
        const request = { ...baseModel, version };
        const validationResult = validationService.validateRegisterModelRequest(request);
        expect(validationResult.isValid).toBe(true);
      });

      // Verify version ordering
      const sortedVersions = VersionUtils.sortVersionsAscending(versions);
      expect(sortedVersions).toEqual(['1.0.0', '1.0.1', '1.1.0', '2.0.0']);

      // Test next version generation
      expect(VersionUtils.getNextPatchVersion('1.0.0')).toBe('1.0.1');
      expect(VersionUtils.getNextMinorVersion('1.0.1')).toBe('1.1.0');
      expect(VersionUtils.getNextMajorVersion('1.1.0')).toBe('2.0.0');
    });

    it('should validate different model types and frameworks', () => {
      const modelTypes = [
        {
          name: 'fraud-detection',
          framework: ModelFramework.SCIKIT_LEARN,
          target: DeploymentTarget.EKS,
        },
        {
          name: 'recommendation-engine',
          framework: ModelFramework.TENSORFLOW,
          target: DeploymentTarget.LAMBDA,
        },
        {
          name: 'sentiment-analysis',
          framework: ModelFramework.PYTORCH,
          target: DeploymentTarget.EKS,
        },
        {
          name: 'price-prediction',
          framework: ModelFramework.XGBOOST,
          target: DeploymentTarget.LAMBDA,
        },
      ];

      modelTypes.forEach(modelType => {
        const request: RegisterModelRequest = {
          modelName: modelType.name,
          version: '1.0.0',
          framework: modelType.framework,
          s3Uri: `s3://ml-models/${modelType.name}/v1.0.0/model.pkl`,
          deploymentTarget: modelType.target,
          teamId: 'data-science-team',
          metadata: {
            description: `${modelType.name} model using ${modelType.framework}`,
            accuracy: 0.9,
          },
        };

        const validationResult = validationService.validateRegisterModelRequest(request);
        expect(validationResult.isValid).toBe(true);
      });
    });
  });

  describe('Error Handling Integration', () => {
    it('should provide comprehensive error information', () => {
      const invalidRequest = {
        modelName: 'Invalid Model Name!', // Invalid characters
        version: '1.0', // Invalid format
        framework: 'invalid-framework' as ModelFramework,
        s3Uri: 'not-an-s3-uri',
        deploymentTarget: 'invalid-target' as DeploymentTarget,
        teamId: 'team@invalid!',
        metadata: {
          description: 'a'.repeat(1001), // Too long
          accuracy: 2.0, // Invalid range
          features: Array(101).fill('feature'), // Too many
          tags: Array(21).fill('tag'), // Too many
        },
      };

      const validationResult = validationService.validateRegisterModelRequest(invalidRequest);
      
      expect(validationResult.isValid).toBe(false);
      expect(validationResult.errors).toBeDefined();
      
      // Should have errors for multiple fields
      const errorFields = Object.keys(validationResult.errors!);
      expect(errorFields.length).toBeGreaterThan(5);
      
      // Check specific error fields
      expect(validationResult.errors!.modelName).toBeDefined();
      expect(validationResult.errors!.version).toBeDefined();
      expect(validationResult.errors!.s3Uri).toBeDefined();
    });

    it('should handle edge cases in validation', () => {
      // Test empty strings
      const emptyStringValidations = [
        validationService.validateModelId(''),
        validationService.validateVersion(''),
        validationService.validateTeamId(''),
      ];

      emptyStringValidations.forEach(result => {
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
      });

      // Test boundary conditions
      const boundaryTests = [
        validationService.validatePaginationParams('1'), // Minimum valid
        validationService.validatePaginationParams('100'), // Maximum valid
        validationService.validatePaginationParams('101'), // Over maximum
      ];

      expect(boundaryTests[0].isValid).toBe(true);
      expect(boundaryTests[1].isValid).toBe(true);
      expect(boundaryTests[2].isValid).toBe(false);
    });
  });
});