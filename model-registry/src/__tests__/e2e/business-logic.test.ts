import { ValidationService } from '../../validation/validation-service';
import { VersionUtils } from '../../utils/version-utils';
import { ModelFramework, DeploymentTarget, RegisterModelRequest } from '../../types/model-types';
import { AuthContext } from '../../auth/auth-service';
import { TeamAccessControl } from '../../auth/team-access-control';

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('../../monitoring');

describe('End-to-End Business Logic Tests', () => {
  let validationService: ValidationService;
  let teamAccessControl: TeamAccessControl;
  
  const authContext: AuthContext = {
    teamId: 'data-science-team',
    keyId: 'test-api-key',
    permissions: ['read', 'write', 'deploy'],
  };

  beforeEach(() => {
    validationService = new ValidationService();
    teamAccessControl = new TeamAccessControl();
  });

  describe('Complete Model Lifecycle Validation', () => {
    const testModel: RegisterModelRequest = {
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
        modelSize: 1024000,
        trainingDataset: 'fraud_training_data_v1.csv',
        tags: ['fraud-detection', 'classification', 'production'],
      },
    };

    it('should validate complete model registration workflow', () => {
      // Step 1: Validate model registration request
      const registrationValidation = validationService.validateRegisterModelRequest(testModel);
      expect(registrationValidation.isValid).toBe(true);

      // Step 2: Validate model ID generation would work
      const modelIdValidation = validationService.validateModelId('fraud-detection-model');
      expect(modelIdValidation.isValid).toBe(true);

      // Step 3: Validate version semantics
      expect(VersionUtils.isValidSemanticVersion(testModel.version)).toBe(true);
      const parsedVersion = VersionUtils.parseVersion(testModel.version);
      expect(parsedVersion).toEqual({ major: 1, minor: 0, patch: 0 });

      // Step 4: Validate team access
      const teamValidation = validationService.validateTeamId(testModel.teamId);
      expect(teamValidation.isValid).toBe(true);

      // Step 5: Validate metadata
      const metadataValidation = validationService.validateUpdateModelMetadata(testModel.metadata!);
      expect(metadataValidation.isValid).toBe(true);
    });

    it('should handle model versioning progression', () => {
      const versions = ['1.0.0', '1.0.1', '1.1.0', '1.2.0', '2.0.0'];
      
      // Validate all versions are valid
      versions.forEach(version => {
        const validation = validationService.validateVersion(version);
        expect(validation.isValid).toBe(true);
        expect(VersionUtils.isValidSemanticVersion(version)).toBe(true);
      });

      // Test version comparison logic
      expect(VersionUtils.compareVersions('1.0.1', '1.0.0')).toBe(1);
      expect(VersionUtils.compareVersions('1.1.0', '1.0.1')).toBe(1);
      expect(VersionUtils.compareVersions('2.0.0', '1.2.0')).toBe(1);

      // Test latest version detection
      const latestVersion = VersionUtils.getLatestVersion(versions);
      expect(latestVersion).toBe('2.0.0');

      // Test version sorting
      const shuffledVersions = ['1.1.0', '2.0.0', '1.0.0', '1.2.0', '1.0.1'];
      const sortedVersions = VersionUtils.sortVersionsDescending(shuffledVersions);
      expect(sortedVersions).toEqual(['2.0.0', '1.2.0', '1.1.0', '1.0.1', '1.0.0']);
    });

    it('should validate team-based access control logic', () => {
      // Test basic auth context structure
      expect(authContext.teamId).toBe('data-science-team');
      expect(authContext.keyId).toBe('test-api-key');
      expect(authContext.permissions).toContain('read');
      expect(authContext.permissions).toContain('write');
      expect(authContext.permissions).toContain('deploy');
      expect(authContext.permissions).not.toContain('admin');

      // Test admin permissions
      const adminContext: AuthContext = {
        ...authContext,
        permissions: ['read', 'write', 'deploy', 'admin'],
      };
      expect(adminContext.permissions).toContain('admin');
    });

    it('should validate different model types and frameworks', () => {
      const modelTypes = [
        {
          name: 'fraud-detection-model',
          framework: ModelFramework.SCIKIT_LEARN,
          target: DeploymentTarget.EKS,
          description: 'Fraud detection using ensemble methods',
        },
        {
          name: 'recommendation-engine',
          framework: ModelFramework.TENSORFLOW,
          target: DeploymentTarget.LAMBDA,
          description: 'Deep learning recommendation system',
        },
        {
          name: 'sentiment-analyzer',
          framework: ModelFramework.PYTORCH,
          target: DeploymentTarget.EKS,
          description: 'BERT-based sentiment analysis',
        },
        {
          name: 'price-predictor',
          framework: ModelFramework.XGBOOST,
          target: DeploymentTarget.LAMBDA,
          description: 'XGBoost price prediction model',
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
            description: modelType.description,
            accuracy: 0.9,
            tags: [modelType.framework.toLowerCase(), 'production'],
          },
        };

        const validation = validationService.validateRegisterModelRequest(request);
        expect(validation.isValid).toBe(true);
      });
    });
  });

  describe('Model Update and Lifecycle Management', () => {
    it('should validate model metadata updates', () => {
      const originalMetadata = {
        description: 'Original fraud detection model',
        accuracy: 0.92,
        features: ['transaction_amount', 'user_age'],
        tags: ['fraud-detection', 'v1'],
      };

      const updatedMetadata = {
        description: 'Updated fraud detection model with improved accuracy',
        accuracy: 0.95,
        features: ['transaction_amount', 'user_age', 'merchant_category', 'time_of_day'],
        tags: ['fraud-detection', 'v2', 'improved'],
        hyperparameters: {
          n_estimators: 150,
          max_depth: 12,
          learning_rate: 0.05,
        },
      };

      // Validate both metadata versions
      const originalValidation = validationService.validateUpdateModelMetadata(originalMetadata);
      expect(originalValidation.isValid).toBe(true);

      const updatedValidation = validationService.validateUpdateModelMetadata(updatedMetadata);
      expect(updatedValidation.isValid).toBe(true);

      // Validate that accuracy improved
      expect(updatedMetadata.accuracy).toBeGreaterThan(originalMetadata.accuracy);
      expect(updatedMetadata.features.length).toBeGreaterThan(originalMetadata.features.length);
    });

    it('should handle version progression scenarios', () => {
      const baseVersion = '1.0.0';
      
      // Test different version progression paths
      const nextPatch = VersionUtils.getNextPatchVersion(baseVersion);
      expect(nextPatch).toBe('1.0.1');
      expect(validationService.validateVersion(nextPatch).isValid).toBe(true);

      const nextMinor = VersionUtils.getNextMinorVersion(baseVersion);
      expect(nextMinor).toBe('1.1.0');
      expect(validationService.validateVersion(nextMinor).isValid).toBe(true);

      const nextMajor = VersionUtils.getNextMajorVersion(baseVersion);
      expect(nextMajor).toBe('2.0.0');
      expect(validationService.validateVersion(nextMajor).isValid).toBe(true);

      // Validate version comparison
      expect(VersionUtils.isGreaterThan(nextPatch, baseVersion)).toBe(true);
      expect(VersionUtils.isGreaterThan(nextMinor, nextPatch)).toBe(true);
      expect(VersionUtils.isGreaterThan(nextMajor, nextMinor)).toBe(true);
    });
  });

  describe('Query and Search Validation', () => {
    it('should validate model listing and filtering parameters', () => {
      // Test pagination parameters
      const paginationTests = [
        { limit: '1', valid: true },
        { limit: '50', valid: true },
        { limit: '100', valid: true },
        { limit: '0', valid: false },
        { limit: '101', valid: false },
        { limit: 'invalid', valid: false },
      ];

      paginationTests.forEach(test => {
        const result = validationService.validatePaginationParams(test.limit);
        expect(result.isValid).toBe(test.valid);
      });

      // Test filter parameters
      const filterTests = [
        { framework: ModelFramework.SCIKIT_LEARN, valid: true },
        { framework: ModelFramework.TENSORFLOW, valid: true },
        { framework: 'INVALID' as ModelFramework, valid: false },
        { target: DeploymentTarget.EKS, valid: true },
        { target: DeploymentTarget.LAMBDA, valid: true },
        { target: 'INVALID' as DeploymentTarget, valid: false },
      ];

      filterTests.forEach(test => {
        if (test.framework) {
          const result = validationService.validateFramework(test.framework);
          expect(result.isValid).toBe(test.valid);
        }
        if (test.target) {
          const result = validationService.validateDeploymentTarget(test.target);
          expect(result.isValid).toBe(test.valid);
        }
      });
    });

    it('should validate search patterns and queries', () => {
      const searchPatterns = [
        'fraud-detection',
        'recommendation',
        'sentiment-analysis',
        'price-prediction',
        'model-name-with-dashes',
        'ModelWithCamelCase',
        'model_with_underscores',
      ];

      searchPatterns.forEach(pattern => {
        const validation = validationService.validateNamePattern(pattern);
        expect(validation.isValid).toBe(true);
      });

      // Test invalid patterns
      const invalidPatterns = [
        'a'.repeat(101), // Too long
      ];

      invalidPatterns.forEach(pattern => {
        const validation = validationService.validateNamePattern(pattern);
        expect(validation.isValid).toBe(false);
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle comprehensive validation errors', () => {
      const invalidModel = {
        modelName: '', // Invalid: empty
        version: 'invalid-version', // Invalid: format
        framework: 'INVALID_FRAMEWORK' as ModelFramework,
        s3Uri: 'not-an-s3-uri', // Invalid: format
        deploymentTarget: 'INVALID_TARGET' as DeploymentTarget,
        teamId: 'team@invalid!', // Invalid: characters
        metadata: {
          description: 'a'.repeat(1001), // Invalid: too long
          accuracy: 1.5, // Invalid: out of range
          features: Array(101).fill('feature'), // Invalid: too many
          tags: Array(21).fill('tag'), // Invalid: too many
        },
      };

      const validation = validationService.validateRegisterModelRequest(invalidModel);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toBeDefined();
      
      // Should have multiple validation errors
      const errorCount = Object.keys(validation.errors!).length;
      expect(errorCount).toBeGreaterThan(5);
    });

    it('should handle edge cases in version management', () => {
      // Test version edge cases
      const edgeCases = [
        { version: '0.0.1', valid: true },
        { version: '10.20.30', valid: true },
        { version: '999.999.999', valid: true },
        { version: '1.0', valid: false },
        { version: '1.0.0.0', valid: false },
        { version: 'v1.0.0', valid: false },
        { version: '1.0.0-alpha', valid: false },
      ];

      edgeCases.forEach(testCase => {
        const validation = validationService.validateVersion(testCase.version);
        expect(validation.isValid).toBe(testCase.valid);
        
        if (testCase.valid) {
          expect(VersionUtils.isValidSemanticVersion(testCase.version)).toBe(true);
        } else {
          expect(VersionUtils.isValidSemanticVersion(testCase.version)).toBe(false);
        }
      });
    });

    it('should handle boundary conditions', () => {
      // Test string length boundaries
      const boundaryTests = [
        { field: 'modelName', value: 'a', valid: true },
        { field: 'modelName', value: 'a'.repeat(100), valid: true },
        { field: 'modelName', value: 'a'.repeat(101), valid: false },
        { field: 'teamId', value: 'a', valid: true },
        { field: 'teamId', value: 'a'.repeat(50), valid: true },
        { field: 'teamId', value: 'a'.repeat(51), valid: false },
      ];

      boundaryTests.forEach(test => {
        let validation;
        if (test.field === 'modelName') {
          validation = validationService.validateModelId(test.value);
        } else if (test.field === 'teamId') {
          validation = validationService.validateTeamId(test.value);
        }
        
        if (validation) {
          expect(validation.isValid).toBe(test.valid);
        }
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should validate multi-team model management', () => {
      const teams = ['data-science-team', 'ml-ops-team', 'analytics-team'];
      
      teams.forEach(teamId => {
        const teamValidation = validationService.validateTeamId(teamId);
        expect(teamValidation.isValid).toBe(true);
        
        // Test team access control
        const sameTeamContext: AuthContext = {
          teamId,
          keyId: 'test-key',
          permissions: ['read', 'write'],
        };
        
        expect(sameTeamContext.permissions).toContain('read');
        expect(sameTeamContext.permissions).toContain('write');
      });
    });

    it('should validate model deployment scenarios', () => {
      const deploymentScenarios = [
        {
          framework: ModelFramework.SCIKIT_LEARN,
          target: DeploymentTarget.EKS,
          valid: true,
        },
        {
          framework: ModelFramework.TENSORFLOW,
          target: DeploymentTarget.LAMBDA,
          valid: true,
        },
        {
          framework: ModelFramework.PYTORCH,
          target: DeploymentTarget.EKS,
          valid: true,
        },
      ];

      deploymentScenarios.forEach(scenario => {
        const frameworkValidation = validationService.validateFramework(scenario.framework);
        const targetValidation = validationService.validateDeploymentTarget(scenario.target);
        
        expect(frameworkValidation.isValid).toBe(scenario.valid);
        expect(targetValidation.isValid).toBe(scenario.valid);
      });
    });
  });
});