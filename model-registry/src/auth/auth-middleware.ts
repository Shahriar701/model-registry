import { APIGatewayProxyEvent } from 'aws-lambda';
import { AuthService, AuthContext } from './auth-service';
import { Logger } from '../utils/logger';
import { ModelRegistryError, ErrorType } from '../utils/error-handler';

export interface AuthenticatedRequest extends APIGatewayProxyEvent {
  authContext: AuthContext;
}

export class AuthMiddleware {
  private readonly authService: AuthService;
  private readonly logger: Logger;

  constructor() {
    this.authService = new AuthService();
    this.logger = new Logger();
  }

  /**
   * Authenticates a request and returns the auth context
   * Can be used when API Gateway authorizer is not configured
   */
  async authenticate(event: APIGatewayProxyEvent, correlationId: string): Promise<AuthContext> {
    // First, try to get auth context from API Gateway authorizer
    if (event.requestContext.authorizer?.teamId) {
      this.logger.info('Using API Gateway authorizer context', {
        correlationId,
        teamId: event.requestContext.authorizer.teamId,
      });

      return {
        teamId: event.requestContext.authorizer.teamId,
        keyId: event.requestContext.authorizer.keyId || 'unknown',
        permissions: event.requestContext.authorizer.permissions 
          ? JSON.parse(event.requestContext.authorizer.permissions)
          : [],
      };
    }

    // Fallback to manual authentication
    const authHeader = event.headers.Authorization || event.headers.authorization;
    
    if (!authHeader) {
      throw new ModelRegistryError(
        ErrorType.UNAUTHORIZED,
        'Authorization header is required',
        401
      );
    }

    this.logger.info('Performing manual authentication', {
      correlationId,
    });

    const apiKey = this.extractApiKey(authHeader);
    return await this.authService.validateApiKey(apiKey, correlationId);
  }

  /**
   * Checks if the authenticated user has the required permission
   */
  checkPermission(authContext: AuthContext, requiredPermission: string): void {
    if (!this.authService.hasPermission(authContext, requiredPermission)) {
      this.logger.warn('Permission check failed', {
        teamId: authContext.teamId,
        keyId: authContext.keyId,
        requiredPermission,
        userPermissions: authContext.permissions,
      });

      throw new ModelRegistryError(
        ErrorType.UNAUTHORIZED,
        `Insufficient permissions. Required: ${requiredPermission}`,
        403
      );
    }
  }

  /**
   * Checks if the authenticated user can access resources for the specified team
   */
  checkTeamAccess(authContext: AuthContext, targetTeamId: string): void {
    if (!this.authService.canAccessTeam(authContext, targetTeamId)) {
      throw new ModelRegistryError(
        ErrorType.UNAUTHORIZED,
        `Access denied for team: ${targetTeamId}`,
        403
      );
    }
  }

  /**
   * Validates team access for model operations
   * Returns the effective team ID to use for the operation
   */
  validateTeamAccess(authContext: AuthContext, requestedTeamId?: string): string {
    // If no specific team is requested, use the authenticated user's team
    if (!requestedTeamId) {
      return authContext.teamId;
    }

    // Check if user can access the requested team
    this.checkTeamAccess(authContext, requestedTeamId);
    
    return requestedTeamId;
  }

  /**
   * Extracts API key from authorization header
   */
  private extractApiKey(authorizationHeader: string): string {
    // Support both "Bearer" and "ApiKey" prefixes
    const bearerMatch = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    const apiKeyMatch = authorizationHeader.match(/^ApiKey\s+(.+)$/i);
    
    if (bearerMatch) {
      return bearerMatch[1];
    }
    
    if (apiKeyMatch) {
      return apiKeyMatch[1];
    }

    // If no prefix, assume the entire header value is the API key
    return authorizationHeader;
  }
}

/**
 * Higher-order function that wraps Lambda handlers with authentication
 */
export function withAuth<T extends APIGatewayProxyEvent>(
  handler: (event: T & { authContext: AuthContext }, correlationId: string) => Promise<any>,
  requiredPermission?: string
) {
  const authMiddleware = new AuthMiddleware();

  return async (event: T, correlationId: string) => {
    // Authenticate the request
    const authContext = await authMiddleware.authenticate(event, correlationId);

    // Check required permission if specified
    if (requiredPermission) {
      authMiddleware.checkPermission(authContext, requiredPermission);
    }

    // Add auth context to event and call the handler
    const authenticatedEvent = { ...event, authContext };
    return await handler(authenticatedEvent, correlationId);
  };
}