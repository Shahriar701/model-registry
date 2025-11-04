import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult, Context } from 'aws-lambda';
import { AuthService } from './auth-service';
import { Logger } from '../utils/logger';

const authService = new AuthService();
const logger = new Logger();

/**
 * Lambda authorizer function for API Gateway
 * Validates API keys and returns IAM policy
 */
export const handler = async (
  event: APIGatewayTokenAuthorizerEvent,
  context: Context
): Promise<APIGatewayAuthorizerResult> => {
  const correlationId = `auth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info('Processing authorization request', {
    correlationId,
    methodArn: event.methodArn,
    type: event.type,
  });

  try {
    // Extract API key from authorization token
    const apiKey = extractApiKey(event.authorizationToken);
    
    // Validate API key and get auth context
    const authContext = await authService.validateApiKey(apiKey, correlationId);

    logger.info('Authorization successful', {
      correlationId,
      teamId: authContext.teamId,
      keyId: authContext.keyId,
    });

    // Generate IAM policy allowing access
    const policy = generatePolicy('Allow', event.methodArn, authContext);

    return {
      principalId: authContext.teamId,
      policyDocument: policy,
      context: {
        teamId: authContext.teamId,
        keyId: authContext.keyId,
        permissions: JSON.stringify(authContext.permissions),
        correlationId,
      },
    };
  } catch (error) {
    logger.error('Authorization failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      methodArn: event.methodArn,
    });

    // Return deny policy for any authorization failure
    const policy = generatePolicy('Deny', event.methodArn);

    return {
      principalId: 'unauthorized',
      policyDocument: policy,
      context: {
        error: error instanceof Error ? error.message : 'Authorization failed',
        correlationId,
      },
    };
  }
};

/**
 * Extracts API key from authorization token
 * Supports both "Bearer" and "ApiKey" prefixes
 */
function extractApiKey(authorizationToken: string): string {
  if (!authorizationToken) {
    throw new Error('Authorization token is required');
  }

  // Support both "Bearer <token>" and "ApiKey <token>" formats
  const bearerMatch = authorizationToken.match(/^Bearer\s+(.+)$/i);
  const apiKeyMatch = authorizationToken.match(/^ApiKey\s+(.+)$/i);
  
  if (bearerMatch) {
    return bearerMatch[1];
  }
  
  if (apiKeyMatch) {
    return apiKeyMatch[1];
  }

  // If no prefix, assume the entire token is the API key
  return authorizationToken;
}

/**
 * Generates IAM policy document for API Gateway
 */
function generatePolicy(
  effect: 'Allow' | 'Deny',
  resource: string,
  authContext?: { teamId: string; keyId: string; permissions: string[] }
): any {
  const policyDocument = {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      },
    ],
  };

  // For Allow policies, we can add more granular permissions based on auth context
  if (effect === 'Allow' && authContext) {
    // Add additional statements based on permissions
    if (authContext.permissions.includes('admin')) {
      // Admin can access all resources
      policyDocument.Statement[0].Resource = resource.replace(/\/[^\/]*$/, '/*');
    }
  }

  return policyDocument;
}

/**
 * Standalone function to validate requests in Lambda functions
 * (alternative to using API Gateway authorizer)
 */
export async function validateRequest(
  authorizationHeader: string | undefined,
  correlationId: string
): Promise<{ teamId: string; keyId: string; permissions: string[] }> {
  if (!authorizationHeader) {
    throw new Error('Authorization header is required');
  }

  const apiKey = extractApiKey(authorizationHeader);
  return await authService.validateApiKey(apiKey, correlationId);
}