import { ModelRegistryService } from '../model-registry-service';
import { ModelFramework, DeploymentTarget } from '../types/model-types';

// Mock all dependencies
const mockDynamoClient = {
  send: jest.fn(),
};

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoClient),
  },
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
}));

jest.mock('../utils/logger');
jest.mock('../auth/team-access-control');
jest.mock('../monitoring');
jest.mock('../services/deployment-pipeline-service');

describe('ModelRegistryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set required environment variables
    process.env.MODELS_TABLE_NAME = 'test-models-table';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
  });

  describe('Service Initialization', () => {
    it('should initialize service with required environment variables', () => {
      expect(process.env.MODELS_TABLE_NAME).toBe('test-models-table');
      expect(process.env.EVENT_BUS_NAME).toBe('test-event-bus');
    });

    it('should throw error if MODELS_TABLE_NAME is missing', () => {
      delete process.env.MODELS_TABLE_NAME;
      
      expect(() => new ModelRegistryService()).toThrow('MODELS_TABLE_NAME environment variable is required');
      
      // Restore for other tests
      process.env.MODELS_TABLE_NAME = 'test-models-table';
    });

    it('should create service instance successfully', () => {
      const service = new ModelRegistryService();
      expect(service).toBeInstanceOf(ModelRegistryService);
      expect(service.getDynamoClient()).toBeDefined();
      expect(service.getTableName()).toBe('test-models-table');
    });
  });

  describe('generateModelId', () => {
    it('should generate valid model ID from name', () => {
      const service = new ModelRegistryService();
      // Access private method through type assertion
      const generateModelId = (service as any).generateModelId.bind(service);

      expect(generateModelId('Test Model Name')).toBe('test-model-name');
      expect(generateModelId('model_with_underscores')).toBe('model-with-underscores');
      expect(generateModelId('Model123')).toBe('model123');
      expect(generateModelId('---multiple---dashes---')).toBe('multiple-dashes');
    });
  });

  describe('Service Configuration', () => {
    it('should have correct table name', () => {
      const service = new ModelRegistryService();
      expect(service.getTableName()).toBe('test-models-table');
    });

    it('should have deployment pipeline service', () => {
      const service = new ModelRegistryService();
      expect(service.getDeploymentPipelineService()).toBeDefined();
    });
  });
});