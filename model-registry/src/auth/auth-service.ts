import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../utils/logger';
import { ModelRegistryError, ErrorType } from '../utils/error-handler';

export interface ApiKey {
  keyId: string;
  teamId: string;
  keyHash: string;
  isActive: boolean;
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  description?: string;
}

export interface AuthContext {
  teamId: string;
  keyId: string;
  permissions: string[];
}

export class AuthService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly logger: Logger;
  private readonly apiKeysTableName: string;

  constructor() {
    const dynamoDBClient = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(dynamoDBClient);
    this.logger = new Logger();
    this.apiKeysTableName = process.env.API_KEYS_TABLE_NAME || 'model-registry-api-keys';
  }

  /**
   * Validates an API key and returns the authentication context
   */
  async validateApiKey(apiKey: string, correlationId: string): Promise<AuthContext> {
    if (!apiKey) {
      throw new ModelRegistryError(
        ErrorType.UNAUTHORIZED,
        'API key is required',
        401
      );
    }

    // Extract key ID from the API key (format: mr_<keyId>_<secret>)
    const keyParts = apiKey.split('_');
    if (keyParts.length !== 3 || keyParts[0] !== 'mr') {
      throw new ModelRegistryError(
        ErrorType.UNAUTHORIZED,
        'Invalid API key format',
        401
      );
    }

    const keyId = keyParts[1];
    const keySecret = keyParts[2];

    this.logger.info('Validating API key', {
      correlationId,
      keyId,
    });

    try {
      // Get API key from DynamoDB
      const command = new GetCommand({
        TableName: this.apiKeysTableName,
        Key: {
          PK: `APIKEY#${keyId}`,
          SK: `APIKEY#${keyId}`,
        },
      });

      const result = await this.dynamoClient.send(command);

      if (!result.Item) {
        this.logger.warn('API key not found', {
          correlationId,
          keyId,
        });
        throw new ModelRegistryError(
          ErrorType.UNAUTHORIZED,
          'Invalid API key',
          401
        );
      }

      const apiKeyRecord = result.Item as ApiKey;

      // Check if key is active
      if (!apiKeyRecord.isActive) {
        this.logger.warn('Inactive API key used', {
          correlationId,
          keyId,
          teamId: apiKeyRecord.teamId,
        });
        throw new ModelRegistryError(
          ErrorType.UNAUTHORIZED,
          'API key is inactive',
          401
        );
      }

      // Check if key has expired
      if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
        this.logger.warn('Expired API key used', {
          correlationId,
          keyId,
          teamId: apiKeyRecord.teamId,
          expiresAt: apiKeyRecord.expiresAt,
        });
        throw new ModelRegistryError(
          ErrorType.UNAUTHORIZED,
          'API key has expired',
          401
        );
      }

      // Validate key hash (in production, this would be a proper hash comparison)
      const expectedHash = this.hashApiKeySecret(keySecret);
      if (apiKeyRecord.keyHash !== expectedHash) {
        this.logger.warn('Invalid API key secret', {
          correlationId,
          keyId,
          teamId: apiKeyRecord.teamId,
        });
        throw new ModelRegistryError(
          ErrorType.UNAUTHORIZED,
          'Invalid API key',
          401
        );
      }

      // Update last used timestamp (fire and forget)
      this.updateLastUsedTimestamp(keyId, correlationId).catch(error => {
        this.logger.warn('Failed to update last used timestamp', {
          correlationId,
          keyId,
          error: error.message,
        });
      });

      this.logger.info('API key validated successfully', {
        correlationId,
        keyId,
        teamId: apiKeyRecord.teamId,
      });

      return {
        teamId: apiKeyRecord.teamId,
        keyId: apiKeyRecord.keyId,
        permissions: apiKeyRecord.permissions,
      };
    } catch (error) {
      if (error instanceof ModelRegistryError) {
        throw error;
      }

      this.logger.error('Error validating API key', {
        correlationId,
        keyId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new ModelRegistryError(
        ErrorType.INTERNAL_ERROR,
        'Authentication service error',
        500
      );
    }
  }

  /**
   * Checks if the authenticated user has the required permission
   */
  hasPermission(authContext: AuthContext, requiredPermission: string): boolean {
    // Admin permission grants all access
    if (authContext.permissions.includes('admin')) {
      return true;
    }

    return authContext.permissions.includes(requiredPermission);
  }

  /**
   * Checks if the authenticated user can access resources for the specified team
   */
  canAccessTeam(authContext: AuthContext, targetTeamId: string): boolean {
    // Admin permission grants access to all teams
    if (authContext.permissions.includes('admin')) {
      return true;
    }

    // Users can access their own team's resources
    return authContext.teamId === targetTeamId;
  }

  /**
   * Creates a simple hash of the API key secret (for demo purposes)
   * In production, use a proper cryptographic hash function
   */
  private hashApiKeySecret(secret: string): string {
    // This is a simple hash for demo purposes
    // In production, use bcrypt, scrypt, or similar
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  /**
   * Updates the last used timestamp for an API key
   */
  private async updateLastUsedTimestamp(keyId: string, correlationId: string): Promise<void> {
    try {
      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
      
      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.apiKeysTableName,
        Key: {
          PK: `APIKEY#${keyId}`,
          SK: `APIKEY#${keyId}`,
        },
        UpdateExpression: 'SET lastUsedAt = :timestamp',
        ExpressionAttributeValues: {
          ':timestamp': new Date().toISOString(),
        },
      }));
    } catch (error) {
      // Don't throw - this is a non-critical operation
      this.logger.warn('Failed to update last used timestamp', {
        correlationId,
        keyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}