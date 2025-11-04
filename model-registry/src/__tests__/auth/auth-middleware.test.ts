import { AuthMiddleware } from '../../auth/auth-middleware';
import { AuthService } from '../../auth/auth-service';
import { ModelRegistryError, ErrorType } from '../../utils/error-handler';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AuthService
jest.mock('../../auth/auth-service');

const mockAuthService = {
  validateApiKey: jest.fn(),
  hasPermission: jest.fn(),
  canAccessTeam: jest.fn(),
};

(AuthService as jest.Mock).mockImplementation(() => mockAuthService);

describe('AuthMiddleware', () => {
  let authMiddleware: AuthMiddleware;
  const correlationId = 'test-correlation-id';

  beforeEach(() => {
    jest.clearAllMocks();
    authMiddleware = new AuthMiddleware();
  });

  const createMockEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/api/v1/models',
    resource: '/api/v1/models',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
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
      path: '/api/v1/models',
      protocol: 'HTTP/1.1',
      requestId: 'test-request-id',
      requestTime: '01/Jan/2023:00:00:00 +0000',
      requestTimeEpoch: 1672531200,
      resourceId: 'test-resource',
      resourcePath: '/api/v1/models',
      stage: 'test',
    },
    stageVariables: null,
    multiValueQueryStringParameters: null,
    ...overrides,
  });

  describe('authenticate', () => {
    it('should use API Gateway authorizer context when available', async () => {
      const event = createMockEvent({
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            teamId: 'team-alpha',
            keyId: 'test123',
            permissions: JSON.stringify(['models:read']),
          },
        },
      });

      const result = await authMiddleware.authenticate(event, correlationId);

      expect(result).toEqual({
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      });

      expect(mockAuthService.validateApiKey).not.toHaveBeenCalled();
    });

    it('should fallback to manual authentication when no authorizer context', async () => {
      const event = createMockEvent({
        headers: {
          Authorization: 'Bearer mr_test123_secret456',
        },
      });

      const mockAuthContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      };

      mockAuthService.validateApiKey.mockResolvedValueOnce(mockAuthContext);

      const result = await authMiddleware.authenticate(event, correlationId);

      expect(result).toEqual(mockAuthContext);
      expect(mockAuthService.validateApiKey).toHaveBeenCalledWith('mr_test123_secret456', correlationId);
    });

    it('should throw error when no authorization header', async () => {
      const event = createMockEvent();

      await expect(authMiddleware.authenticate(event, correlationId))
        .rejects.toThrow(ModelRegistryError);
    });

    it('should extract API key from different header formats', async () => {
      const testCases = [
        { header: 'Bearer mr_test123_secret456', expected: 'mr_test123_secret456' },
        { header: 'ApiKey mr_test123_secret456', expected: 'mr_test123_secret456' },
        { header: 'mr_test123_secret456', expected: 'mr_test123_secret456' },
      ];

      for (const testCase of testCases) {
        const event = createMockEvent({
          headers: {
            Authorization: testCase.header,
          },
        });

        mockAuthService.validateApiKey.mockResolvedValueOnce({
          teamId: 'team-alpha',
          keyId: 'test123',
          permissions: ['models:read'],
        });

        await authMiddleware.authenticate(event, correlationId);

        expect(mockAuthService.validateApiKey).toHaveBeenCalledWith(testCase.expected, correlationId);
        jest.clearAllMocks();
      }
    });
  });

  describe('checkPermission', () => {
    it('should not throw when user has required permission', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:write'],
      };

      mockAuthService.hasPermission.mockReturnValueOnce(true);

      expect(() => authMiddleware.checkPermission(authContext, 'models:write')).not.toThrow();
    });

    it('should throw when user lacks required permission', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      };

      mockAuthService.hasPermission.mockReturnValueOnce(false);

      expect(() => authMiddleware.checkPermission(authContext, 'models:write'))
        .toThrow(ModelRegistryError);
    });
  });

  describe('validateTeamAccess', () => {
    it('should return user team when no specific team requested', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      };

      const result = authMiddleware.validateTeamAccess(authContext);

      expect(result).toBe('team-alpha');
    });

    it('should return requested team when user has access', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['admin'],
      };

      mockAuthService.canAccessTeam.mockReturnValueOnce(true);

      const result = authMiddleware.validateTeamAccess(authContext, 'team-beta');

      expect(result).toBe('team-beta');
      expect(mockAuthService.canAccessTeam).toHaveBeenCalledWith(authContext, 'team-beta');
    });

    it('should throw when user lacks team access', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      };

      mockAuthService.canAccessTeam.mockReturnValueOnce(false);

      expect(() => authMiddleware.validateTeamAccess(authContext, 'team-beta'))
        .toThrow(ModelRegistryError);
    });
  });
});