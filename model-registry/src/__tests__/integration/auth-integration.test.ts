import { handler } from '../../index';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock all AWS services
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-cloudwatch');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-cloudwatch-logs');

describe('Authentication Integration Tests', () => {
  const validApiKey = 'mr_test123_secret456';
  const validApiKeyHash = require('crypto').createHash('sha256').update('secret456').digest('hex');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MODELS_TABLE_NAME = 'test-models-table';
    process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
  });

  const createMockEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/api/v1/models/test-model/1.0.0',
    resource: '/api/v1/models/{modelId}/{version}',
    pathParameters: { modelId: 'test-model', version: '1.0.0' },
    queryStringParameters: null,
    headers: {
      Authorization: `Bearer ${validApiKey}`,
    },
    multiValueHeaders: {},
    body: null,
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {},
      httpMethod: 'GET',
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      } as any,
      path: '/api/v1/models/test-model/1.0.0',
      protocol: 'HTTP/1.1',
      requestId: 'test-request-id',
      requestTime: '01/Jan/2023:00:00:00 +0000',
      requestTimeEpoch: 1672531200,
      resourceId: 'test-resource',
      resourcePath: '/api/v1/models/{modelId}/{version}',
      stage: 'test',
    },
    stageVariables: null,
    multiValueQueryStringParameters: null,
    ...overrides,
  });

  describe('Authentication Flow', () => {
    it('should return 401 for invalid API key format', async () => {
      const event = createMockEvent({
        headers: {
          Authorization: 'Bearer invalid-key',
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          type: 'UNAUTHORIZED',
        },
      });
    });

    it('should return 401 for missing authorization header', async () => {
      const event = createMockEvent({
        headers: {},
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          type: 'UNAUTHORIZED',
        },
      });
    });

    it('should handle health check without authentication', async () => {
      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/api/v1/health',
        pathParameters: null,
        headers: {},
      });

      const result = await handler(event);

      // Health check should work without authentication
      expect(result.statusCode).toBe(200);
    });

    it('should return 404 for unknown routes', async () => {
      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/api/v1/unknown',
        pathParameters: null,
        headers: {},
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          type: 'RESOURCE_NOT_FOUND',
        },
      });
    });
  });
});