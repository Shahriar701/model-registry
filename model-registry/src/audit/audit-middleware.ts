import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuditLogger, AuditEventType } from './audit-logger';
import { AuthContext } from '../auth/auth-service';
import { Logger } from '../utils/logger';

export class AuditMiddleware {
  private readonly auditLogger: AuditLogger;
  private readonly logger: Logger;

  constructor() {
    this.auditLogger = new AuditLogger();
    this.logger = new Logger();
  }

  /**
   * Extracts client information from API Gateway event
   */
  private extractClientInfo(event: APIGatewayProxyEvent): { sourceIp?: string; userAgent?: string } {
    return {
      sourceIp: event.requestContext.identity?.sourceIp,
      userAgent: event.headers['User-Agent'] || event.headers['user-agent'],
    };
  }

  /**
   * Logs model registration events
   */
  async logModelRegistration(
    authContext: AuthContext,
    correlationId: string,
    modelId: string,
    version: string,
    result: 'SUCCESS' | 'FAILURE',
    event: APIGatewayProxyEvent,
    additionalDetails: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    await this.auditLogger.logModelOperation(
      AuditEventType.MODEL_REGISTERED,
      authContext,
      correlationId,
      modelId,
      version,
      result,
      additionalDetails,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs model access events
   */
  async logModelAccess(
    authContext: AuthContext,
    correlationId: string,
    modelId: string,
    version: string,
    result: 'SUCCESS' | 'FAILURE',
    event: APIGatewayProxyEvent,
    additionalDetails: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    await this.auditLogger.logModelOperation(
      AuditEventType.MODEL_ACCESSED,
      authContext,
      correlationId,
      modelId,
      version,
      result,
      additionalDetails,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs model update events
   */
  async logModelUpdate(
    authContext: AuthContext,
    correlationId: string,
    modelId: string,
    version: string,
    result: 'SUCCESS' | 'FAILURE',
    event: APIGatewayProxyEvent,
    additionalDetails: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    await this.auditLogger.logModelOperation(
      AuditEventType.MODEL_UPDATED,
      authContext,
      correlationId,
      modelId,
      version,
      result,
      additionalDetails,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs model deletion events
   */
  async logModelDeletion(
    authContext: AuthContext,
    correlationId: string,
    modelId: string,
    version: string,
    result: 'SUCCESS' | 'FAILURE',
    event: APIGatewayProxyEvent,
    additionalDetails: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    await this.auditLogger.logModelOperation(
      AuditEventType.MODEL_DELETED,
      authContext,
      correlationId,
      modelId,
      version,
      result,
      additionalDetails,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs model deployment events
   */
  async logModelDeployment(
    authContext: AuthContext,
    correlationId: string,
    modelId: string,
    version: string,
    result: 'SUCCESS' | 'FAILURE',
    event: APIGatewayProxyEvent,
    additionalDetails: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    await this.auditLogger.logModelOperation(
      AuditEventType.MODEL_DEPLOYED,
      authContext,
      correlationId,
      modelId,
      version,
      result,
      additionalDetails,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs authentication events
   */
  async logAuthentication(
    correlationId: string,
    keyId: string | undefined,
    teamId: string | undefined,
    result: 'SUCCESS' | 'FAILURE',
    event: APIGatewayProxyEvent,
    details: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    const eventType = result === 'SUCCESS' 
      ? AuditEventType.AUTHENTICATION_SUCCESS 
      : AuditEventType.AUTHENTICATION_FAILURE;

    await this.auditLogger.logAuthenticationEvent(
      eventType,
      correlationId,
      keyId,
      teamId,
      result,
      details,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs authorization failures
   */
  async logAuthorizationFailure(
    authContext: AuthContext | null,
    correlationId: string,
    resource: string,
    requiredPermission: string,
    event: APIGatewayProxyEvent,
    details: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    await this.auditLogger.logAuthorizationFailure(
      authContext,
      correlationId,
      resource,
      requiredPermission,
      details,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs API key usage for all requests
   */
  async logApiKeyUsage(
    authContext: AuthContext,
    correlationId: string,
    event: APIGatewayProxyEvent,
    response: APIGatewayProxyResult,
    details: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    const endpoint = `${event.httpMethod} ${event.resource}`;
    const result = response.statusCode < 400 ? 'SUCCESS' : 'FAILURE';

    await this.auditLogger.logApiKeyUsage(
      authContext,
      correlationId,
      endpoint,
      event.httpMethod,
      result,
      response.statusCode,
      {
        pathParameters: event.pathParameters,
        queryStringParameters: event.queryStringParameters,
        ...details,
      },
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs team access events
   */
  async logTeamAccess(
    authContext: AuthContext,
    correlationId: string,
    targetTeamId: string,
    resource: string,
    granted: boolean,
    event: APIGatewayProxyEvent,
    details: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    const eventType = granted 
      ? AuditEventType.TEAM_ACCESS_GRANTED 
      : AuditEventType.TEAM_ACCESS_DENIED;

    await this.auditLogger.logTeamAccess(
      eventType,
      authContext,
      correlationId,
      targetTeamId,
      resource,
      details,
      sourceIp,
      userAgent
    );
  }

  /**
   * Logs security violations
   */
  async logSecurityViolation(
    correlationId: string,
    threatType: string,
    attackVector: string,
    event: APIGatewayProxyEvent,
    authContext?: AuthContext,
    details: Record<string, any> = {}
  ): Promise<void> {
    const { sourceIp, userAgent } = this.extractClientInfo(event);

    await this.auditLogger.logSecurityViolation(
      AuditEventType.SECURITY_VIOLATION,
      correlationId,
      threatType,
      attackVector,
      authContext,
      {
        endpoint: `${event.httpMethod} ${event.resource}`,
        pathParameters: event.pathParameters,
        queryStringParameters: event.queryStringParameters,
        ...details,
      },
      sourceIp,
      userAgent
    );
  }
}

/**
 * Higher-order function that wraps handlers with audit logging
 */
export function withAuditLogging<T extends APIGatewayProxyEvent>(
  handler: (event: T, correlationId: string) => Promise<APIGatewayProxyResult>,
  operationType?: 'read' | 'write' | 'delete' | 'deploy'
) {
  const auditMiddleware = new AuditMiddleware();

  return async (event: T, correlationId: string): Promise<APIGatewayProxyResult> => {
    let authContext: AuthContext | undefined;
    let response: APIGatewayProxyResult;

    try {
      // Execute the handler
      response = await handler(event, correlationId);

      // Extract auth context if available
      if (event.requestContext.authorizer?.teamId) {
        authContext = {
          teamId: event.requestContext.authorizer.teamId,
          keyId: event.requestContext.authorizer.keyId || 'unknown',
          permissions: event.requestContext.authorizer.permissions 
            ? JSON.parse(event.requestContext.authorizer.permissions)
            : [],
        };
      }

      // Log API key usage if authenticated
      if (authContext) {
        await auditMiddleware.logApiKeyUsage(
          authContext,
          correlationId,
          event,
          response
        );
      }

      return response;
    } catch (error) {
      // Create error response
      response = {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        body: JSON.stringify({
          error: {
            type: 'INTERNAL_ERROR',
            message: 'Internal server error',
            correlationId,
            timestamp: new Date().toISOString(),
          },
        }),
      };

      // Log API key usage for failed requests if authenticated
      if (authContext) {
        await auditMiddleware.logApiKeyUsage(
          authContext,
          correlationId,
          event,
          response,
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      throw error;
    }
  };
}