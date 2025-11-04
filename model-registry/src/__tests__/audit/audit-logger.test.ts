import { AuditLogger, AuditEventType } from '../../audit/audit-logger';
import { AuthContext } from '../../auth/auth-service';

// Mock AWS SDK
const mockCloudWatchLogsClient = {
  send: jest.fn(),
};

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(() => mockCloudWatchLogsClient),
  PutLogEventsCommand: jest.fn(),
  CreateLogStreamCommand: jest.fn(),
}));

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  const correlationId = 'test-correlation-id';
  const authContext: AuthContext = {
    teamId: 'team-alpha',
    keyId: 'test123',
    permissions: ['models:read', 'models:write'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    auditLogger = new AuditLogger();
  });

  describe('logModelOperation', () => {
    it('should log model registration successfully', async () => {
      mockCloudWatchLogsClient.send.mockResolvedValueOnce({});

      await auditLogger.logModelOperation(
        AuditEventType.MODEL_REGISTERED,
        authContext,
        correlationId,
        'test-model',
        '1.0.0',
        'SUCCESS',
        { framework: 'tensorflow' },
        '127.0.0.1',
        'test-agent'
      );

      expect(mockCloudWatchLogsClient.send).toHaveBeenCalled();
    });

    it('should handle logging failures gracefully', async () => {
      mockCloudWatchLogsClient.send.mockRejectedValueOnce(new Error('CloudWatch error'));

      // Should not throw
      await expect(auditLogger.logModelOperation(
        AuditEventType.MODEL_REGISTERED,
        authContext,
        correlationId,
        'test-model',
        '1.0.0',
        'SUCCESS'
      )).resolves.not.toThrow();
    });
  });

  describe('logAuthenticationEvent', () => {
    it('should log successful authentication', async () => {
      mockCloudWatchLogsClient.send.mockResolvedValueOnce({});

      await auditLogger.logAuthenticationEvent(
        AuditEventType.AUTHENTICATION_SUCCESS,
        correlationId,
        'test123',
        'team-alpha',
        'SUCCESS',
        {},
        '127.0.0.1',
        'test-agent'
      );

      expect(mockCloudWatchLogsClient.send).toHaveBeenCalled();
    });

    it('should log failed authentication', async () => {
      mockCloudWatchLogsClient.send.mockResolvedValueOnce({});

      await auditLogger.logAuthenticationEvent(
        AuditEventType.AUTHENTICATION_FAILURE,
        correlationId,
        undefined,
        undefined,
        'FAILURE',
        { reason: 'Invalid API key' }
      );

      expect(mockCloudWatchLogsClient.send).toHaveBeenCalled();
    });
  });

  describe('logSecurityViolation', () => {
    it('should log security violation', async () => {
      mockCloudWatchLogsClient.send.mockResolvedValueOnce({});

      await auditLogger.logSecurityViolation(
        AuditEventType.SECURITY_VIOLATION,
        correlationId,
        'SQL_INJECTION',
        'REQUEST_PARAMETER',
        authContext,
        { suspiciousInput: 'DROP TABLE users' }
      );

      expect(mockCloudWatchLogsClient.send).toHaveBeenCalled();
    });
  });

  describe('logApiKeyUsage', () => {
    it('should log successful API key usage', async () => {
      mockCloudWatchLogsClient.send.mockResolvedValueOnce({});

      await auditLogger.logApiKeyUsage(
        authContext,
        correlationId,
        '/api/v1/models',
        'GET',
        'SUCCESS',
        200,
        { responseTime: 150 }
      );

      expect(mockCloudWatchLogsClient.send).toHaveBeenCalled();
    });

    it('should log failed API key usage', async () => {
      mockCloudWatchLogsClient.send.mockResolvedValueOnce({});

      await auditLogger.logApiKeyUsage(
        authContext,
        correlationId,
        '/api/v1/models',
        'POST',
        'FAILURE',
        403
      );

      expect(mockCloudWatchLogsClient.send).toHaveBeenCalled();
    });
  });
});