import { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand } from '@aws-sdk/client-cloudwatch-logs';
import { Logger } from '../utils/logger';
import { AuthContext } from '../auth/auth-service';

export enum AuditEventType {
  MODEL_REGISTERED = 'MODEL_REGISTERED',
  MODEL_ACCESSED = 'MODEL_ACCESSED',
  MODEL_UPDATED = 'MODEL_UPDATED',
  MODEL_DELETED = 'MODEL_DELETED',
  MODEL_DEPLOYED = 'MODEL_DEPLOYED',
  AUTHENTICATION_SUCCESS = 'AUTHENTICATION_SUCCESS',
  AUTHENTICATION_FAILURE = 'AUTHENTICATION_FAILURE',
  AUTHORIZATION_FAILURE = 'AUTHORIZATION_FAILURE',
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
  API_KEY_USED = 'API_KEY_USED',
  TEAM_ACCESS_GRANTED = 'TEAM_ACCESS_GRANTED',
  TEAM_ACCESS_DENIED = 'TEAM_ACCESS_DENIED',
}

export interface AuditEvent {
  eventType: AuditEventType;
  timestamp: string;
  correlationId: string;
  userId?: string;
  teamId?: string;
  keyId?: string;
  sourceIp?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  result: 'SUCCESS' | 'FAILURE';
  details: Record<string, any>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface SecurityEvent extends AuditEvent {
  threatType?: string;
  attackVector?: string;
  mitigationAction?: string;
}

export class AuditLogger {
  private readonly cloudWatchLogsClient: CloudWatchLogsClient;
  private readonly logger: Logger;
  private readonly logGroupName: string;
  private readonly logStreamName: string;

  constructor() {
    this.cloudWatchLogsClient = new CloudWatchLogsClient({});
    this.logger = new Logger();
    this.logGroupName = process.env.AUDIT_LOG_GROUP_NAME || '/aws/lambda/model-registry-audit';
    this.logStreamName = `audit-${new Date().toISOString().split('T')[0]}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Logs a model operation audit event
   */
  async logModelOperation(
    eventType: AuditEventType,
    authContext: AuthContext,
    correlationId: string,
    modelId: string,
    version?: string,
    result: 'SUCCESS' | 'FAILURE' = 'SUCCESS',
    additionalDetails: Record<string, any> = {},
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      eventType,
      timestamp: new Date().toISOString(),
      correlationId,
      teamId: authContext.teamId,
      keyId: authContext.keyId,
      sourceIp,
      userAgent,
      resource: `model:${modelId}${version ? `:${version}` : ''}`,
      action: this.getActionFromEventType(eventType),
      result,
      details: {
        modelId,
        version,
        permissions: authContext.permissions,
        ...additionalDetails,
      },
      riskLevel: this.calculateRiskLevel(eventType, result, additionalDetails),
    };

    await this.writeAuditEvent(auditEvent);
  }

  /**
   * Logs an authentication event
   */
  async logAuthenticationEvent(
    eventType: AuditEventType.AUTHENTICATION_SUCCESS | AuditEventType.AUTHENTICATION_FAILURE,
    correlationId: string,
    keyId?: string,
    teamId?: string,
    result: 'SUCCESS' | 'FAILURE' = 'SUCCESS',
    details: Record<string, any> = {},
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      eventType,
      timestamp: new Date().toISOString(),
      correlationId,
      teamId,
      keyId,
      sourceIp,
      userAgent,
      resource: 'authentication',
      action: 'authenticate',
      result,
      details: {
        ...details,
        // Don't log sensitive information like API keys
        keyId: keyId ? `${keyId.substring(0, 8)}...` : undefined,
      },
      riskLevel: result === 'FAILURE' ? 'HIGH' : 'LOW',
    };

    await this.writeAuditEvent(auditEvent);
  }

  /**
   * Logs an authorization failure event
   */
  async logAuthorizationFailure(
    authContext: AuthContext | null,
    correlationId: string,
    resource: string,
    requiredPermission: string,
    details: Record<string, any> = {},
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      eventType: AuditEventType.AUTHORIZATION_FAILURE,
      timestamp: new Date().toISOString(),
      correlationId,
      teamId: authContext?.teamId,
      keyId: authContext?.keyId,
      sourceIp,
      userAgent,
      resource,
      action: 'authorize',
      result: 'FAILURE',
      details: {
        requiredPermission,
        userPermissions: authContext?.permissions || [],
        ...details,
      },
      riskLevel: 'MEDIUM',
    };

    await this.writeAuditEvent(auditEvent);
  }

  /**
   * Logs a security violation event
   */
  async logSecurityViolation(
    eventType: AuditEventType.SECURITY_VIOLATION,
    correlationId: string,
    threatType: string,
    attackVector: string,
    authContext?: AuthContext,
    details: Record<string, any> = {},
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const securityEvent: SecurityEvent = {
      eventType,
      timestamp: new Date().toISOString(),
      correlationId,
      teamId: authContext?.teamId,
      keyId: authContext?.keyId,
      sourceIp,
      userAgent,
      resource: 'security',
      action: 'violation_detected',
      result: 'FAILURE',
      details: {
        threatType,
        attackVector,
        userPermissions: authContext?.permissions || [],
        ...details,
      },
      riskLevel: 'CRITICAL',
      threatType,
      attackVector,
      mitigationAction: 'REQUEST_BLOCKED',
    };

    await this.writeAuditEvent(securityEvent);

    // Also log to application logs for immediate visibility
    this.logger.error('Security violation detected', {
      correlationId,
      threatType,
      attackVector,
      sourceIp,
      teamId: authContext?.teamId,
    });
  }

  /**
   * Logs team access events
   */
  async logTeamAccess(
    eventType: AuditEventType.TEAM_ACCESS_GRANTED | AuditEventType.TEAM_ACCESS_DENIED,
    authContext: AuthContext,
    correlationId: string,
    targetTeamId: string,
    resource: string,
    details: Record<string, any> = {},
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      eventType,
      timestamp: new Date().toISOString(),
      correlationId,
      teamId: authContext.teamId,
      keyId: authContext.keyId,
      sourceIp,
      userAgent,
      resource,
      action: 'team_access_check',
      result: eventType === AuditEventType.TEAM_ACCESS_GRANTED ? 'SUCCESS' : 'FAILURE',
      details: {
        targetTeamId,
        userPermissions: authContext.permissions,
        ...details,
      },
      riskLevel: eventType === AuditEventType.TEAM_ACCESS_DENIED ? 'MEDIUM' : 'LOW',
    };

    await this.writeAuditEvent(auditEvent);
  }

  /**
   * Logs API key usage
   */
  async logApiKeyUsage(
    authContext: AuthContext,
    correlationId: string,
    endpoint: string,
    httpMethod: string,
    result: 'SUCCESS' | 'FAILURE',
    responseCode: number,
    details: Record<string, any> = {},
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      eventType: AuditEventType.API_KEY_USED,
      timestamp: new Date().toISOString(),
      correlationId,
      teamId: authContext.teamId,
      keyId: authContext.keyId,
      sourceIp,
      userAgent,
      resource: endpoint,
      action: httpMethod.toLowerCase(),
      result,
      details: {
        endpoint,
        httpMethod,
        responseCode,
        permissions: authContext.permissions,
        ...details,
      },
      riskLevel: result === 'FAILURE' && responseCode >= 400 ? 'MEDIUM' : 'LOW',
    };

    await this.writeAuditEvent(auditEvent);
  }

  /**
   * Writes an audit event to CloudWatch Logs
   */
  private async writeAuditEvent(auditEvent: AuditEvent | SecurityEvent): Promise<void> {
    try {
      // Ensure log stream exists
      await this.ensureLogStream();

      // Prepare log event
      const logEvent = {
        timestamp: new Date(auditEvent.timestamp).getTime(),
        message: JSON.stringify(auditEvent),
      };

      // Send to CloudWatch Logs
      const command = new PutLogEventsCommand({
        logGroupName: this.logGroupName,
        logStreamName: this.logStreamName,
        logEvents: [logEvent],
      });

      await this.cloudWatchLogsClient.send(command);

      // Also log to application logs for debugging
      this.logger.info('Audit event logged', {
        eventType: auditEvent.eventType,
        correlationId: auditEvent.correlationId,
        result: auditEvent.result,
        riskLevel: auditEvent.riskLevel,
      });
    } catch (error) {
      this.logger.error('Failed to write audit event', {
        correlationId: auditEvent.correlationId,
        eventType: auditEvent.eventType,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback: log to application logs
      this.logger.info('AUDIT_EVENT', auditEvent);
    }
  }

  /**
   * Ensures the CloudWatch log stream exists
   */
  private async ensureLogStream(): Promise<void> {
    try {
      const command = new CreateLogStreamCommand({
        logGroupName: this.logGroupName,
        logStreamName: this.logStreamName,
      });

      await this.cloudWatchLogsClient.send(command);
    } catch (error: any) {
      // Ignore if log stream already exists
      if (error.name !== 'ResourceAlreadyExistsException') {
        this.logger.warn('Failed to create log stream', {
          logGroupName: this.logGroupName,
          logStreamName: this.logStreamName,
          error: error.message,
        });
      }
    }
  }

  /**
   * Maps event types to actions
   */
  private getActionFromEventType(eventType: AuditEventType): string {
    const actionMap: Record<AuditEventType, string> = {
      [AuditEventType.MODEL_REGISTERED]: 'register',
      [AuditEventType.MODEL_ACCESSED]: 'read',
      [AuditEventType.MODEL_UPDATED]: 'update',
      [AuditEventType.MODEL_DELETED]: 'delete',
      [AuditEventType.MODEL_DEPLOYED]: 'deploy',
      [AuditEventType.AUTHENTICATION_SUCCESS]: 'authenticate',
      [AuditEventType.AUTHENTICATION_FAILURE]: 'authenticate',
      [AuditEventType.AUTHORIZATION_FAILURE]: 'authorize',
      [AuditEventType.SECURITY_VIOLATION]: 'security_check',
      [AuditEventType.API_KEY_USED]: 'api_access',
      [AuditEventType.TEAM_ACCESS_GRANTED]: 'team_access',
      [AuditEventType.TEAM_ACCESS_DENIED]: 'team_access',
    };

    return actionMap[eventType] || 'unknown';
  }

  /**
   * Calculates risk level based on event type and context
   */
  private calculateRiskLevel(
    eventType: AuditEventType,
    result: 'SUCCESS' | 'FAILURE',
    details: Record<string, any>
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    // Failure events are generally higher risk
    if (result === 'FAILURE') {
      switch (eventType) {
        case AuditEventType.AUTHENTICATION_FAILURE:
          return 'HIGH';
        case AuditEventType.AUTHORIZATION_FAILURE:
          return 'MEDIUM';
        case AuditEventType.MODEL_DELETED:
          return 'HIGH';
        default:
          return 'MEDIUM';
      }
    }

    // Success events risk levels
    switch (eventType) {
      case AuditEventType.MODEL_DELETED:
        return 'MEDIUM';
      case AuditEventType.MODEL_DEPLOYED:
        return 'MEDIUM';
      case AuditEventType.SECURITY_VIOLATION:
        return 'CRITICAL';
      default:
        return 'LOW';
    }
  }
}