import { DeploymentPipelineService, DeploymentStatus } from '../../services/deployment-pipeline-service';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { DeploymentTarget } from '../../types/model-types';

// Mock AWS clients
const mockDynamoClient = {
  send: jest.fn(),
} as unknown as DynamoDBDocumentClient;

const mockEventBridgeClient = {
  send: jest.fn(),
} as unknown as EventBridgeClient;

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => mockEventBridgeClient),
  PutEventsCommand: jest.fn(),
}));

describe('DeploymentPipelineService', () => {
  let deploymentPipelineService: DeploymentPipelineService;

  beforeEach(() => {
    deploymentPipelineService = new DeploymentPipelineService(
      mockDynamoClient,
      'test-table',
      'test-event-bus'
    );
    
    jest.clearAllMocks();
  });

  describe('triggerDeployment', () => {
    it('should trigger deployment and publish event', async () => {
      // Mock DynamoDB responses
      (mockDynamoClient.send as jest.Mock)
        .mockResolvedValueOnce({}) // UpdateCommand for model status
        .mockResolvedValueOnce({}) // PutCommand for deployment history
        .mockResolvedValueOnce({}); // Additional calls if any

      // Mock EventBridge response
      (mockEventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'test-event-id' }],
      });

      const request = {
        modelId: 'test-model',
        version: '1.0.0',
        deploymentTarget: DeploymentTarget.EKS,
        teamId: 'test-team',
        metadata: { framework: 'scikit-learn' },
      };

      const result = await deploymentPipelineService.triggerDeployment(
        request,
        'test-correlation-id'
      );

      expect(result.status).toBe(DeploymentStatus.INITIATED);
      expect(result.deploymentId).toMatch(/^deploy-test-model-1\.0\.0-\d+-\w+$/);
      expect(result.message).toBe('Deployment initiated successfully');
      expect(result.eventBridgeMessageId).toBe('test-event-id');

      // Verify DynamoDB calls
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(2);
      
      // Verify EventBridge call
      expect(mockEventBridgeClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle deployment trigger failure', async () => {
      // Mock DynamoDB failure
      (mockDynamoClient.send as jest.Mock)
        .mockRejectedValueOnce(new Error('DynamoDB error'))
        .mockResolvedValueOnce({}); // For error recording

      const request = {
        modelId: 'test-model',
        version: '1.0.0',
        deploymentTarget: DeploymentTarget.EKS,
        teamId: 'test-team',
      };

      await expect(
        deploymentPipelineService.triggerDeployment(request, 'test-correlation-id')
      ).rejects.toThrow('DynamoDB error');

      // Should still record the failure (3 calls: failed update, then 2 for error recording)
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(3);
    });
  });

  describe('updateDeploymentStatus', () => {
    it('should update deployment status and model status', async () => {
      // Mock getting deployment info
      (mockDynamoClient.send as jest.Mock)
        .mockResolvedValueOnce({
          Items: [{
            deploymentId: 'test-deployment-id',
            modelId: 'test-model',
            version: '1.0.0',
            deploymentTarget: DeploymentTarget.EKS,
            teamId: 'test-team',
          }],
        })
        .mockResolvedValueOnce({}) // UpdateCommand for model status
        .mockResolvedValueOnce({}); // PutCommand for deployment history

      const update = {
        deploymentId: 'test-deployment-id',
        status: DeploymentStatus.DEPLOYED,
        metadata: { endpoint: 'https://api.example.com/model' },
      };

      await deploymentPipelineService.updateDeploymentStatus(
        update,
        'test-correlation-id'
      );

      expect(mockDynamoClient.send).toHaveBeenCalledTimes(3);
    });

    it('should throw error for non-existent deployment', async () => {
      // Mock empty response for deployment info
      (mockDynamoClient.send as jest.Mock).mockResolvedValueOnce({
        Items: [],
      });

      const update = {
        deploymentId: 'non-existent-deployment',
        status: DeploymentStatus.DEPLOYED,
      };

      await expect(
        deploymentPipelineService.updateDeploymentStatus(update, 'test-correlation-id')
      ).rejects.toThrow('Deployment non-existent-deployment not found');
    });
  });

  describe('getDeploymentHistory', () => {
    it('should get deployment history for specific deployment', async () => {
      const mockDeploymentHistory = [
        {
          PK: 'DEPLOYMENT#test-deployment-id',
          SK: 'EVENT#2024-01-01T00:00:00Z',
          deploymentId: 'test-deployment-id',
          modelId: 'test-model',
          version: '1.0.0',
          status: DeploymentStatus.INITIATED,
          deploymentTarget: DeploymentTarget.EKS,
          teamId: 'test-team',
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          PK: 'DEPLOYMENT#test-deployment-id',
          SK: 'EVENT#2024-01-01T00:05:00Z',
          deploymentId: 'test-deployment-id',
          modelId: 'test-model',
          version: '1.0.0',
          status: DeploymentStatus.DEPLOYED,
          deploymentTarget: DeploymentTarget.EKS,
          teamId: 'test-team',
          timestamp: '2024-01-01T00:05:00Z',
        },
      ];

      (mockDynamoClient.send as jest.Mock).mockResolvedValue({
        Items: mockDeploymentHistory,
      });

      const result = await deploymentPipelineService.getDeploymentHistory(
        { deploymentId: 'test-deployment-id' },
        'test-correlation-id'
      );

      expect(result.deployments).toHaveLength(2);
      expect(result.deployments[0].status).toBe(DeploymentStatus.INITIATED);
      expect(result.deployments[1].status).toBe(DeploymentStatus.DEPLOYED);
      expect(result.pagination.totalCount).toBe(2);
    });

    it('should get deployment history for model version', async () => {
      const mockDeploymentHistory = [
        {
          GSI1PK: 'MODEL#test-model#VERSION#1.0.0',
          GSI1SK: 'DEPLOYMENT#test-deployment-id#2024-01-01T00:00:00Z',
          deploymentId: 'test-deployment-id',
          modelId: 'test-model',
          version: '1.0.0',
          status: DeploymentStatus.DEPLOYED,
          deploymentTarget: DeploymentTarget.EKS,
          teamId: 'test-team',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ];

      (mockDynamoClient.send as jest.Mock).mockResolvedValue({
        Items: mockDeploymentHistory,
      });

      const result = await deploymentPipelineService.getDeploymentHistory(
        { modelId: 'test-model', version: '1.0.0' },
        'test-correlation-id'
      );

      expect(result.deployments).toHaveLength(1);
      expect(result.deployments[0].modelId).toBe('test-model');
      expect(result.deployments[0].version).toBe('1.0.0');
    });

    it('should throw error for invalid query', async () => {
      await expect(
        deploymentPipelineService.getDeploymentHistory({}, 'test-correlation-id')
      ).rejects.toThrow('Either deploymentId or both modelId and version must be provided');
    });
  });

  describe('cancelDeployment', () => {
    it('should cancel deployment and publish event', async () => {
      // Mock getting deployment info
      (mockDynamoClient.send as jest.Mock)
        .mockResolvedValueOnce({
          Items: [{
            deploymentId: 'test-deployment-id',
            modelId: 'test-model',
            version: '1.0.0',
            deploymentTarget: DeploymentTarget.EKS,
            teamId: 'test-team',
          }],
        })
        .mockResolvedValueOnce({
          Items: [{
            deploymentId: 'test-deployment-id',
            modelId: 'test-model',
            version: '1.0.0',
            deploymentTarget: DeploymentTarget.EKS,
            teamId: 'test-team',
          }],
        })
        .mockResolvedValueOnce({}) // UpdateCommand for model status
        .mockResolvedValueOnce({}); // PutCommand for deployment history

      // Mock EventBridge response
      (mockEventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'test-event-id' }],
      });

      await deploymentPipelineService.cancelDeployment(
        'test-deployment-id',
        'User requested cancellation',
        'test-correlation-id'
      );

      expect(mockDynamoClient.send).toHaveBeenCalledTimes(4);
      expect(mockEventBridgeClient.send).toHaveBeenCalledTimes(1);
    });
  });
});