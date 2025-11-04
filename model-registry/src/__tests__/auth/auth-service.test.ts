import { AuthService, ApiKey } from '../../auth/auth-service';
import { ModelRegistryError, ErrorType } from '../../utils/error-handler';

// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');

const mockDynamoClient = {
  send: jest.fn(),
};

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoClient),
  },
  GetCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

describe('AuthService', () => {
  let authService: AuthService;
  const correlationId = 'test-correlation-id';

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService();
  });

  describe('validateApiKey', () => {
    it('should validate a valid API key successfully', async () => {
      const apiKey = 'mr_test123_secret456';
      const mockApiKeyRecord: ApiKey = {
        keyId: 'test123',
        teamId: 'team-alpha',
        keyHash: require('crypto').createHash('sha256').update('secret456').digest('hex'),
        isActive: true,
        permissions: ['models:read', 'models:write'],
        createdAt: '2023-01-01T00:00:00Z',
      };

      mockDynamoClient.send.mockResolvedValueOnce({
        Item: mockApiKeyRecord,
      });

      const result = await authService.validateApiKey(apiKey, correlationId);

      expect(result).toEqual({
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read', 'models:write'],
      });
    });

    it('should throw error for invalid API key format', async () => {
      const apiKey = 'invalid-format';

      await expect(authService.validateApiKey(apiKey, correlationId))
        .rejects.toThrow(ModelRegistryError);
    });

    it('should throw error for non-existent API key', async () => {
      const apiKey = 'mr_test123_secret456';

      mockDynamoClient.send.mockResolvedValueOnce({
        Item: null,
      });

      await expect(authService.validateApiKey(apiKey, correlationId))
        .rejects.toThrow(ModelRegistryError);
    });

    it('should throw error for inactive API key', async () => {
      const apiKey = 'mr_test123_secret456';
      const mockApiKeyRecord: ApiKey = {
        keyId: 'test123',
        teamId: 'team-alpha',
        keyHash: require('crypto').createHash('sha256').update('secret456').digest('hex'),
        isActive: false,
        permissions: ['models:read'],
        createdAt: '2023-01-01T00:00:00Z',
      };

      mockDynamoClient.send.mockResolvedValueOnce({
        Item: mockApiKeyRecord,
      });

      await expect(authService.validateApiKey(apiKey, correlationId))
        .rejects.toThrow(ModelRegistryError);
    });

    it('should throw error for expired API key', async () => {
      const apiKey = 'mr_test123_secret456';
      const mockApiKeyRecord: ApiKey = {
        keyId: 'test123',
        teamId: 'team-alpha',
        keyHash: require('crypto').createHash('sha256').update('secret456').digest('hex'),
        isActive: true,
        permissions: ['models:read'],
        createdAt: '2023-01-01T00:00:00Z',
        expiresAt: '2023-01-01T00:00:00Z', // Expired
      };

      mockDynamoClient.send.mockResolvedValueOnce({
        Item: mockApiKeyRecord,
      });

      await expect(authService.validateApiKey(apiKey, correlationId))
        .rejects.toThrow(ModelRegistryError);
    });

    it('should throw error for invalid key hash', async () => {
      const apiKey = 'mr_test123_wrongsecret';
      const mockApiKeyRecord: ApiKey = {
        keyId: 'test123',
        teamId: 'team-alpha',
        keyHash: require('crypto').createHash('sha256').update('correctsecret').digest('hex'),
        isActive: true,
        permissions: ['models:read'],
        createdAt: '2023-01-01T00:00:00Z',
      };

      mockDynamoClient.send.mockResolvedValueOnce({
        Item: mockApiKeyRecord,
      });

      await expect(authService.validateApiKey(apiKey, correlationId))
        .rejects.toThrow(ModelRegistryError);
    });
  });

  describe('hasPermission', () => {
    it('should return true for admin permission', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['admin'],
      };

      expect(authService.hasPermission(authContext, 'models:write')).toBe(true);
    });

    it('should return true for exact permission match', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read', 'models:write'],
      };

      expect(authService.hasPermission(authContext, 'models:write')).toBe(true);
    });

    it('should return false for missing permission', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      };

      expect(authService.hasPermission(authContext, 'models:write')).toBe(false);
    });
  });

  describe('canAccessTeam', () => {
    it('should return true for admin permission', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['admin'],
      };

      expect(authService.canAccessTeam(authContext, 'team-beta')).toBe(true);
    });

    it('should return true for same team access', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      };

      expect(authService.canAccessTeam(authContext, 'team-alpha')).toBe(true);
    });

    it('should return false for different team access without admin', () => {
      const authContext = {
        teamId: 'team-alpha',
        keyId: 'test123',
        permissions: ['models:read'],
      };

      expect(authService.canAccessTeam(authContext, 'team-beta')).toBe(false);
    });
  });
});