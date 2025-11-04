import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../utils/logger';
import { ModelRegistryError, ErrorType } from '../utils/error-handler';
import { AuthContext } from './auth-service';

export interface TeamPermissions {
  teamId: string;
  permissions: string[];
  sharedTeams?: string[]; // Teams that can access this team's models
  accessibleTeams?: string[]; // Teams this team can access
}

export interface ModelAccessPolicy {
  modelId: string;
  ownerTeamId: string;
  sharedWith: string[]; // Team IDs that have access
  accessLevel: 'read' | 'write' | 'admin';
}

export class TeamAccessControl {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly logger: Logger;
  private readonly tableName: string;

  constructor() {
    const dynamoDBClient = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(dynamoDBClient);
    this.logger = new Logger();
    this.tableName = process.env.MODELS_TABLE_NAME!;
  }

  /**
   * Checks if a team can access a specific model
   */
  async canAccessModel(
    authContext: AuthContext,
    modelId: string,
    version: string,
    requiredAccess: 'read' | 'write' | 'deploy' = 'read',
    correlationId: string
  ): Promise<boolean> {
    this.logger.info('Checking model access', {
      correlationId,
      teamId: authContext.teamId,
      modelId,
      version,
      requiredAccess,
    });

    try {
      // Admin users have access to all models
      if (authContext.permissions.includes('admin')) {
        this.logger.info('Admin access granted', {
          correlationId,
          teamId: authContext.teamId,
          modelId,
        });
        return true;
      }

      // Get the model to check ownership
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `MODEL#${modelId}`,
          SK: `VERSION#${version}`,
        },
      });

      const result = await this.dynamoClient.send(command);

      if (!result.Item) {
        this.logger.warn('Model not found for access check', {
          correlationId,
          modelId,
          version,
        });
        return false;
      }

      const modelOwnerTeamId = result.Item.teamId;

      // Team owns the model
      if (authContext.teamId === modelOwnerTeamId) {
        this.logger.info('Owner access granted', {
          correlationId,
          teamId: authContext.teamId,
          modelId,
        });
        return true;
      }

      // Check if model is shared with the requesting team
      const hasSharedAccess = await this.checkSharedModelAccess(
        authContext.teamId,
        modelId,
        version,
        requiredAccess,
        correlationId
      );

      if (hasSharedAccess) {
        this.logger.info('Shared access granted', {
          correlationId,
          teamId: authContext.teamId,
          modelId,
        });
        return true;
      }

      // Check cross-team permissions
      const hasCrossTeamAccess = await this.checkCrossTeamAccess(
        authContext.teamId,
        modelOwnerTeamId,
        requiredAccess,
        correlationId
      );

      if (hasCrossTeamAccess) {
        this.logger.info('Cross-team access granted', {
          correlationId,
          teamId: authContext.teamId,
          modelId,
          ownerTeamId: modelOwnerTeamId,
        });
        return true;
      }

      this.logger.warn('Access denied', {
        correlationId,
        teamId: authContext.teamId,
        modelId,
        ownerTeamId: modelOwnerTeamId,
        requiredAccess,
      });

      return false;
    } catch (error) {
      this.logger.error('Error checking model access', {
        correlationId,
        teamId: authContext.teamId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Validates that a team can perform an operation on a model
   * Throws an error if access is denied
   */
  async validateModelAccess(
    authContext: AuthContext,
    modelId: string,
    version: string,
    requiredAccess: 'read' | 'write' | 'deploy' = 'read',
    correlationId: string
  ): Promise<void> {
    const hasAccess = await this.canAccessModel(
      authContext,
      modelId,
      version,
      requiredAccess,
      correlationId
    );

    if (!hasAccess) {
      throw new ModelRegistryError(
        ErrorType.UNAUTHORIZED,
        `Access denied for model ${modelId}. Required access: ${requiredAccess}`,
        403
      );
    }
  }

  /**
   * Gets the list of teams that can access models from a specific team
   */
  async getTeamAccessList(teamId: string, correlationId: string): Promise<string[]> {
    this.logger.info('Getting team access list', {
      correlationId,
      teamId,
    });

    try {
      // Get team permissions
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `TEAM#${teamId}`,
          SK: `PERMISSIONS`,
        },
      });

      const result = await this.dynamoClient.send(command);

      if (!result.Item) {
        // No explicit permissions, return only the team itself
        return [teamId];
      }

      const teamPermissions = result.Item as TeamPermissions;
      const accessList = [teamId]; // Team always has access to its own models

      // Add shared teams
      if (teamPermissions.sharedTeams) {
        accessList.push(...teamPermissions.sharedTeams);
      }

      return accessList;
    } catch (error) {
      this.logger.error('Error getting team access list', {
        correlationId,
        teamId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [teamId]; // Fallback to team-only access
    }
  }

  /**
   * Shares a model with specific teams
   */
  async shareModel(
    modelId: string,
    version: string,
    ownerTeamId: string,
    sharedWithTeams: string[],
    accessLevel: 'read' | 'write' = 'read',
    correlationId: string
  ): Promise<void> {
    this.logger.info('Sharing model', {
      correlationId,
      modelId,
      version,
      ownerTeamId,
      sharedWithTeams,
      accessLevel,
    });

    try {
      // Create or update model access policy
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      
      const accessPolicy: ModelAccessPolicy = {
        modelId,
        ownerTeamId,
        sharedWith: sharedWithTeams,
        accessLevel,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `MODEL#${modelId}`,
          SK: `ACCESS_POLICY#${version}`,
          ...accessPolicy,
          createdAt: new Date().toISOString(),
        },
      }));

      this.logger.info('Model sharing configured', {
        correlationId,
        modelId,
        version,
        sharedWithTeams,
      });
    } catch (error) {
      this.logger.error('Error sharing model', {
        correlationId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ModelRegistryError(
        ErrorType.INTERNAL_ERROR,
        'Failed to configure model sharing',
        500
      );
    }
  }

  /**
   * Checks if a model is shared with a specific team
   */
  private async checkSharedModelAccess(
    teamId: string,
    modelId: string,
    version: string,
    requiredAccess: string,
    correlationId: string
  ): Promise<boolean> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `MODEL#${modelId}`,
          SK: `ACCESS_POLICY#${version}`,
        },
      });

      const result = await this.dynamoClient.send(command);

      if (!result.Item) {
        return false; // No sharing policy
      }

      const accessPolicy = result.Item as ModelAccessPolicy;

      // Check if team is in the shared list
      if (!accessPolicy.sharedWith.includes(teamId)) {
        return false;
      }

      // Check access level
      if (requiredAccess === 'write' && accessPolicy.accessLevel === 'read') {
        return false;
      }

      return true;
    } catch (error) {
      this.logger.warn('Error checking shared model access', {
        correlationId,
        teamId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Checks cross-team access permissions
   */
  private async checkCrossTeamAccess(
    requestingTeamId: string,
    ownerTeamId: string,
    requiredAccess: string,
    correlationId: string
  ): Promise<boolean> {
    try {
      // Check if requesting team has access to owner team's resources
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `TEAM#${requestingTeamId}`,
          SK: `PERMISSIONS`,
        },
      });

      const result = await this.dynamoClient.send(command);

      if (!result.Item) {
        return false; // No cross-team permissions
      }

      const teamPermissions = result.Item as TeamPermissions;

      // Check if requesting team can access owner team
      if (teamPermissions.accessibleTeams?.includes(ownerTeamId)) {
        return true;
      }

      return false;
    } catch (error) {
      this.logger.warn('Error checking cross-team access', {
        correlationId,
        requestingTeamId,
        ownerTeamId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}