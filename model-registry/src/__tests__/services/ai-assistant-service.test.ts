import { AIAssistantService } from '../../services/ai-assistant-service';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ModelFramework, DeploymentTarget, ModelStatus } from '../../types/model-types';

// Mock DynamoDB client
const mockDynamoClient = {
  send: jest.fn(),
} as unknown as DynamoDBDocumentClient;

describe('AIAssistantService', () => {
  let aiAssistantService: AIAssistantService;

  beforeEach(() => {
    aiAssistantService = new AIAssistantService(mockDynamoClient, 'test-table');
    jest.clearAllMocks();
  });

  describe('transformToAIModelData', () => {
    it('should transform model registration to AI model data', async () => {
      const mockModel = {
        PK: 'MODEL#test-model',
        SK: 'VERSION#1.0.0',
        modelId: 'test-model',
        modelName: 'Test Model',
        version: '1.0.0',
        framework: ModelFramework.SCIKIT_LEARN,
        deploymentTarget: DeploymentTarget.EKS,
        status: ModelStatus.DEPLOYED,
        teamId: 'test-team',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        s3Uri: 's3://test-bucket/model.pkl',
        metadata: {
          description: 'A test model for fraud detection',
          accuracy: 0.95,
          features: ['transaction_amount', 'user_age'],
          tags: ['fraud', 'classification'],
        },
        GSI1PK: 'TEAM#test-team',
        GSI1SK: 'MODEL#test-model#VERSION#1.0.0',
        GSI2PK: 'DEPLOYMENT#EKS',
        GSI2SK: 'TEAM#test-team#MODEL#test-model#VERSION#1.0.0',
      };

      // Mock DynamoDB response
      (mockDynamoClient.send as jest.Mock).mockResolvedValue({
        Items: [mockModel],
      });

      const result = await aiAssistantService.getModelsForRAG('test-team', 'test-correlation-id');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        modelId: 'test-model',
        modelName: 'Test Model',
        version: '1.0.0',
        framework: ModelFramework.SCIKIT_LEARN,
        deploymentTarget: DeploymentTarget.EKS,
        status: ModelStatus.DEPLOYED,
        teamId: 'test-team',
        description: 'A test model for fraud detection',
        accuracy: 0.95,
        features: ['transaction_amount', 'user_age'],
        tags: ['fraud', 'classification'],
      });

      expect(result[0].searchableText).toContain('test model');
      expect(result[0].searchableText).toContain('fraud detection');
      expect(result[0].capabilities).toContain('machine learning');
      expect(result[0].useCases).toContain('fraud detection');
    });
  });

  describe('searchModels', () => {
    it('should search models with text query', async () => {
      const mockModel = {
        PK: 'MODEL#fraud-detector',
        SK: 'VERSION#1.0.0',
        modelId: 'fraud-detector',
        modelName: 'Fraud Detector',
        version: '1.0.0',
        framework: ModelFramework.SCIKIT_LEARN,
        deploymentTarget: DeploymentTarget.EKS,
        status: ModelStatus.DEPLOYED,
        teamId: 'test-team',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        s3Uri: 's3://test-bucket/model.pkl',
        metadata: {
          description: 'Detects fraudulent transactions',
          accuracy: 0.95,
          tags: ['fraud', 'classification'],
        },
        GSI1PK: 'TEAM#test-team',
        GSI1SK: 'MODEL#fraud-detector#VERSION#1.0.0',
        GSI2PK: 'DEPLOYMENT#EKS',
        GSI2SK: 'TEAM#test-team#MODEL#fraud-detector#VERSION#1.0.0',
      };

      // Mock DynamoDB response
      (mockDynamoClient.send as jest.Mock).mockResolvedValue({
        Items: [mockModel],
      });

      const result = await aiAssistantService.searchModels({
        query: 'fraud',
        teamId: 'test-team',
        limit: 10,
      }, 'test-correlation-id');

      expect(result.models).toHaveLength(1);
      expect(result.models[0].modelName).toBe('Fraud Detector');
      expect(result.searchMetadata.query).toBe('fraud');
      expect(result.searchMetadata.appliedFilters.teamId).toBe('test-team');
      expect(result.totalCount).toBe(1);
    });
  });

  describe('getModelSummaryForAI', () => {
    it('should return model summary statistics', async () => {
      const mockModels = [
        {
          modelId: 'model1',
          framework: ModelFramework.SCIKIT_LEARN,
          deploymentTarget: DeploymentTarget.EKS,
          teamId: 'team1',
          createdAt: '2024-01-01T00:00:00Z',
          metadata: { accuracy: 0.95, tags: ['fraud', 'classification'] },
        },
        {
          modelId: 'model2',
          framework: ModelFramework.TENSORFLOW,
          deploymentTarget: DeploymentTarget.LAMBDA,
          teamId: 'team2',
          createdAt: '2024-01-02T00:00:00Z',
          metadata: { accuracy: 0.88, tags: ['vision', 'detection'] },
        },
      ];

      // Mock DynamoDB response
      (mockDynamoClient.send as jest.Mock).mockResolvedValue({
        Items: mockModels,
      });

      const result = await aiAssistantService.getModelSummaryForAI('test-correlation-id');

      expect(result.totalModels).toBe(2);
      expect(result.modelsByFramework[ModelFramework.SCIKIT_LEARN]).toBe(1);
      expect(result.modelsByFramework[ModelFramework.TENSORFLOW]).toBe(1);
      expect(result.modelsByDeploymentTarget[DeploymentTarget.EKS]).toBe(1);
      expect(result.modelsByDeploymentTarget[DeploymentTarget.LAMBDA]).toBe(1);
      expect(result.averageAccuracy).toBeCloseTo(0.915);
      expect(result.commonTags).toContain('fraud');
      expect(result.commonTags).toContain('classification');
    });
  });
});