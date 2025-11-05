import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Logger } from './utils/logger';
import { ModelRegistration, RegisterModelRequest, ListModelsRequest, ListModelsResponse, ModelSummary, DeploymentTriggerResponse, ModelStatus, ModelStatistics } from './types/model-types';
import { ModelRegistryError, ErrorType } from './utils/error-handler';
import { VersionUtils } from './utils/version-utils';
import { TeamAccessControl } from './auth/team-access-control';
import { AuthContext } from './auth/auth-service';
import { MetricsService, PerformanceMonitor, HealthService, AlertingService } from './monitoring';
import { DeploymentPipelineService } from './services/deployment-pipeline-service';

export class ModelRegistryService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly s3Client: S3Client;
  private readonly logger: Logger;
  private readonly tableName: string;
  private readonly teamAccessControl: TeamAccessControl;
  private readonly metricsService: MetricsService;
  private readonly performanceMonitor: PerformanceMonitor;
  private readonly healthService: HealthService;
  private readonly alertingService: AlertingService;
  private readonly deploymentPipelineService: DeploymentPipelineService;

  constructor() {
    const dynamoDBClient = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(dynamoDBClient);
    this.s3Client = new S3Client({});
    this.logger = new Logger();
    this.tableName = process.env.MODELS_TABLE_NAME!;
    this.teamAccessControl = new TeamAccessControl();
    this.metricsService = new MetricsService();
    this.performanceMonitor = new PerformanceMonitor(this.metricsService);
    this.healthService = new HealthService(this.metricsService);
    this.alertingService = new AlertingService();
    this.deploymentPipelineService = new DeploymentPipelineService(
      this.dynamoClient,
      this.tableName,
      process.env.EVENT_BUS_NAME
    );

    if (!this.tableName) {
      throw new Error('MODELS_TABLE_NAME environment variable is required');
    }
  }

  // Getter for DynamoDB client to support dependency injection
  public getDynamoClient(): DynamoDBDocumentClient {
    return this.dynamoClient;
  }

  // Getter for table name
  public getTableName(): string {
    return this.tableName;
  }

  // Getter for deployment pipeline service
  public getDeploymentPipelineService(): DeploymentPipelineService {
    return this.deploymentPipelineService;
  }

  async registerModel(request: RegisterModelRequest, correlationId: string): Promise<{ modelId: string; message: string; registrationTime: string }> {
    const modelId = this.generateModelId(request.modelName);
    const timestamp = new Date().toISOString();

    this.logger.info('Registering model', {
      correlationId,
      modelId,
      modelName: request.modelName,
      version: request.version,
      framework: request.framework,
      deploymentTarget: request.deploymentTarget,
    });

    // Validate S3 URI
    await this.validateS3Uri(request.s3Uri, correlationId);

    // Check for duplicate model version
    await this.checkDuplicateVersion(modelId, request.version, correlationId);

    // Create model registration record
    const modelRegistration: ModelRegistration = {
      PK: `MODEL#${modelId}`,
      SK: `VERSION#${request.version}`,
      modelId,
      modelName: request.modelName,
      version: request.version,
      framework: request.framework,
      s3Uri: request.s3Uri,
      deploymentTarget: request.deploymentTarget,
      status: ModelStatus.REGISTERED,
      teamId: request.teamId,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: request.metadata || {},
      // GSI keys for team-based queries
      GSI1PK: `TEAM#${request.teamId}`,
      GSI1SK: `MODEL#${modelId}#VERSION#${request.version}`,
      // GSI keys for deployment target queries
      GSI2PK: `DEPLOYMENT#${request.deploymentTarget}`,
      GSI2SK: `TEAM#${request.teamId}#MODEL#${modelId}#VERSION#${request.version}`,
    };

    try {
      await this.performanceMonitor.recordDatabaseOperation(
        'PutItem',
        correlationId,
        async () => {
          await this.dynamoClient.send(new PutCommand({
            TableName: this.tableName,
            Item: modelRegistration,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          }));
        }
      );

      // Emit CloudWatch metrics
      await this.metricsService.recordModelRegistration(
        request.teamId,
        request.framework,
        request.deploymentTarget,
        correlationId
      );

      this.logger.info('Model registered successfully', {
        correlationId,
        modelId,
        version: request.version,
      });

      return {
        modelId,
        message: 'Model registered successfully',
        registrationTime: timestamp,
      };
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new ModelRegistryError(
          ErrorType.DUPLICATE_RESOURCE,
          `Model ${request.modelName} version ${request.version} already exists`,
          409
        );
      }
      throw error;
    }
  }

  async listModels(request: ListModelsRequest, correlationId: string): Promise<ListModelsResponse> {
    this.logger.info('Listing models', {
      correlationId,
      teamId: request.teamId,
      deploymentTarget: request.deploymentTarget,
      namePattern: request.namePattern,
      framework: request.framework,
      status: request.status,
      limit: request.limit,
    });

    const limit = Math.min(request.limit || 50, 100); // Cap at 100
    let command;
    let filterExpressions: string[] = [];
    let expressionAttributeValues: Record<string, any> = {};
    let expressionAttributeNames: Record<string, string> = {};

    // Build filter expressions for additional criteria
    if (request.namePattern) {
      filterExpressions.push('contains(modelName, :namePattern)');
      expressionAttributeValues[':namePattern'] = request.namePattern;
    }

    if (request.framework) {
      filterExpressions.push('framework = :framework');
      expressionAttributeValues[':framework'] = request.framework;
    }

    if (request.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeValues[':status'] = request.status;
      expressionAttributeNames['#status'] = 'status';
    }

    if (request.teamId) {
      // Query by team using GSI1
      const keyConditionExpression = 'GSI1PK = :teamPK';
      expressionAttributeValues[':teamPK'] = `TEAM#${request.teamId}`;

      command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        Limit: limit,
        ExclusiveStartKey: request.nextToken ? JSON.parse(Buffer.from(request.nextToken, 'base64').toString()) : undefined,
      });
    } else if (request.deploymentTarget) {
      // Query by deployment target using GSI2
      const keyConditionExpression = 'GSI2PK = :deploymentPK';
      expressionAttributeValues[':deploymentPK'] = `DEPLOYMENT#${request.deploymentTarget}`;

      command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        Limit: limit,
        ExclusiveStartKey: request.nextToken ? JSON.parse(Buffer.from(request.nextToken, 'base64').toString()) : undefined,
      });
    } else {
      // Scan all models (less efficient, but needed for global listing)
      filterExpressions.unshift('begins_with(PK, :modelPrefix)');
      expressionAttributeValues[':modelPrefix'] = 'MODEL#';

      command = new ScanCommand({
        TableName: this.tableName,
        FilterExpression: filterExpressions.join(' AND '),
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        Limit: limit,
        ExclusiveStartKey: request.nextToken ? JSON.parse(Buffer.from(request.nextToken, 'base64').toString()) : undefined,
      });
    }

    const result = await this.dynamoClient.send(command);

    const models: ModelSummary[] = (result.Items || []).map(item => ({
      modelId: item.modelId,
      modelName: item.modelName,
      version: item.version,
      framework: item.framework,
      deploymentTarget: item.deploymentTarget,
      status: item.status,
      teamId: item.teamId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    const nextToken = result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    return {
      models,
      pagination: {
        nextToken,
        totalCount: models.length,
      },
    };
  }

  async getModelVersions(modelId: string, authContext: AuthContext, correlationId: string): Promise<ModelRegistration[]> {
    this.logger.info('Getting model versions', {
      correlationId,
      modelId,
      teamId: authContext.teamId,
    });

    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `MODEL#${modelId}`,
      },
      ScanIndexForward: false, // Sort by SK descending (newest first)
    });

    const result = await this.dynamoClient.send(command);

    if (!result.Items || result.Items.length === 0) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `Model ${modelId} not found`,
        404
      );
    }

    // Filter versions based on team access control
    const accessibleVersions: ModelRegistration[] = [];
    
    for (const item of result.Items) {
      const modelVersion = item as ModelRegistration;
      
      try {
        // Check if user can access this version
        const canAccess = await this.teamAccessControl.canAccessModel(
          authContext,
          modelId,
          modelVersion.version,
          'read',
          correlationId
        );
        
        if (canAccess) {
          accessibleVersions.push(modelVersion);
        }
      } catch (error) {
        this.logger.warn('Error checking access for model version', {
          correlationId,
          modelId,
          version: modelVersion.version,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (accessibleVersions.length === 0) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `Model ${modelId} not found or access denied`,
        404
      );
    }

    return accessibleVersions;
  }

  async getModelVersion(modelId: string, version: string, authContext: AuthContext, correlationId: string): Promise<ModelRegistration> {
    this.logger.info('Getting model version', {
      correlationId,
      modelId,
      version,
      teamId: authContext.teamId,
    });

    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        PK: `MODEL#${modelId}`,
        SK: `VERSION#${version}`,
      },
    });

    const result = await this.dynamoClient.send(command);

    if (!result.Item) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `Model ${modelId} version ${version} not found`,
        404
      );
    }

    // Validate team access using access control
    await this.teamAccessControl.validateModelAccess(
      authContext,
      modelId,
      version,
      'read',
      correlationId
    );

    return result.Item as ModelRegistration;
  }

  async getLatestModelVersion(modelId: string, authContext: AuthContext, correlationId: string): Promise<ModelRegistration> {
    this.logger.info('Getting latest model version', {
      correlationId,
      modelId,
      teamId: authContext.teamId,
    });

    // Get all accessible versions of the model
    const versions = await this.getModelVersions(modelId, authContext, correlationId);

    if (versions.length === 0) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `No accessible versions found for model ${modelId}`,
        404
      );
    }

    // Find the latest version using semantic version comparison
    const versionStrings = versions.map(v => v.version);
    const latestVersionString = VersionUtils.getLatestVersion(versionStrings);

    if (!latestVersionString) {
      throw new ModelRegistryError(
        ErrorType.INTERNAL_ERROR,
        `Unable to determine latest version for model ${modelId}`,
        500
      );
    }

    // Return the model registration for the latest version
    return versions.find(v => v.version === latestVersionString)!;
  }

  async updateModelMetadata(modelId: string, version: string, metadata: any, authContext: AuthContext, correlationId: string): Promise<ModelRegistration> {
    this.logger.info('Updating model metadata', {
      correlationId,
      modelId,
      version,
      teamId: authContext.teamId,
    });

    // Validate write access to the model
    await this.teamAccessControl.validateModelAccess(
      authContext,
      modelId,
      version,
      'write',
      correlationId
    );

    const timestamp = new Date().toISOString();

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        PK: `MODEL#${modelId}`,
        SK: `VERSION#${version}`,
      },
      UpdateExpression: 'SET metadata = :metadata, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':metadata': metadata,
        ':updatedAt': timestamp,
      },
      ReturnValues: 'ALL_NEW',
    });

    const result = await this.dynamoClient.send(command);
    return result.Attributes as ModelRegistration;
  }

  async deregisterModel(modelId: string, version: string, authContext: AuthContext, correlationId: string): Promise<void> {
    this.logger.info('Deregistering model', {
      correlationId,
      modelId,
      version,
      teamId: authContext.teamId,
    });

    // Validate write access to the model
    await this.teamAccessControl.validateModelAccess(
      authContext,
      modelId,
      version,
      'write',
      correlationId
    );

    await this.performanceMonitor.recordDatabaseOperation(
      'DeleteItem',
      correlationId,
      async () => {
        const command = new DeleteCommand({
          TableName: this.tableName,
          Key: {
            PK: `MODEL#${modelId}`,
            SK: `VERSION#${version}`,
          },
        });

        await this.dynamoClient.send(command);
      }
    );

    // Emit CloudWatch metrics
    await this.metricsService.recordModelDeregistration(authContext.teamId, correlationId);
  }

  async triggerDeployment(modelId: string, version: string, authContext: AuthContext, correlationId: string): Promise<DeploymentTriggerResponse> {
    this.logger.info('Triggering deployment', {
      correlationId,
      modelId,
      version,
      teamId: authContext.teamId,
    });

    // Validate deploy access to the model
    await this.teamAccessControl.validateModelAccess(
      authContext,
      modelId,
      version,
      'deploy',
      correlationId
    );

    // Get model details
    const model = await this.getModelVersion(modelId, version, authContext, correlationId);

    // Use deployment pipeline service to trigger deployment
    const deploymentResult = await this.deploymentPipelineService.triggerDeployment({
      modelId,
      version,
      deploymentTarget: model.deploymentTarget,
      teamId: model.teamId,
      metadata: {
        framework: model.framework,
        s3Uri: model.s3Uri,
        modelMetadata: model.metadata,
      },
    }, correlationId);

    // Emit CloudWatch metrics
    await this.metricsService.recordDeploymentTrigger(
      model.teamId,
      model.deploymentTarget,
      correlationId
    );

    return {
      deploymentId: deploymentResult.deploymentId,
      message: deploymentResult.message,
      status: deploymentResult.status,
      modelId,
      version,
    };
  }

  async getModelStatistics(teamId: string | undefined, correlationId: string): Promise<ModelStatistics> {
    this.logger.info('Getting model statistics', {
      correlationId,
      teamId,
    });

    let command;
    if (teamId) {
      // Query by team using GSI1
      command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :teamPK',
        ExpressionAttributeValues: {
          ':teamPK': `TEAM#${teamId}`,
        },
      });
    } else {
      // Scan all models
      command = new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'begins_with(PK, :modelPrefix)',
        ExpressionAttributeValues: {
          ':modelPrefix': 'MODEL#',
        },
      });
    }

    const result = await this.dynamoClient.send(command);
    const items = result.Items || [];

    // Calculate statistics
    const uniqueModels = new Set<string>();
    const frameworkCounts: Record<string, number> = {};
    const deploymentTargetCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    const teamCounts: Record<string, number> = {};

    items.forEach(item => {
      uniqueModels.add(item.modelId);
      
      // Count by framework
      frameworkCounts[item.framework] = (frameworkCounts[item.framework] || 0) + 1;
      
      // Count by deployment target
      deploymentTargetCounts[item.deploymentTarget] = (deploymentTargetCounts[item.deploymentTarget] || 0) + 1;
      
      // Count by status
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
      
      // Count by team (only if not filtering by team)
      if (!teamId) {
        teamCounts[item.teamId] = (teamCounts[item.teamId] || 0) + 1;
      }
    });

    return {
      totalModels: uniqueModels.size,
      totalVersions: items.length,
      modelsByFramework: frameworkCounts,
      modelsByDeploymentTarget: deploymentTargetCounts,
      modelsByStatus: statusCounts,
      modelsByTeam: teamCounts,
      timestamp: new Date().toISOString(),
    };
  }

  async healthCheck(correlationId: string): Promise<{ status: string; timestamp: string; dependencies: any; [key: string]: any }> {
    this.logger.info('Comprehensive health check requested', { correlationId });

    try {
      const systemHealth = await this.healthService.performHealthCheck(correlationId);
      
      // Process health check for alerting
      await this.alertingService.processHealthCheck(systemHealth, correlationId);

      // Convert to legacy format for backward compatibility
      const dependencies: any = {};
      systemHealth.dependencies.forEach(dep => {
        dependencies[dep.service.toLowerCase()] = dep.status;
      });

      return {
        status: systemHealth.status,
        timestamp: systemHealth.timestamp,
        dependencies,
        // Include additional details for enhanced monitoring
        version: systemHealth.version,
        uptime: systemHealth.uptime,
        summary: systemHealth.summary,
        detailedDependencies: systemHealth.dependencies,
      };
    } catch (error) {
      this.logger.error('Health check failed', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to simple health check
      return await this.simpleHealthCheck(correlationId);
    }
  }

  async simpleHealthCheck(correlationId: string): Promise<{ status: string; timestamp: string; dependencies: any }> {
    this.logger.info('Simple health check requested', { correlationId });

    const result = await this.healthService.getSimpleHealthStatus(correlationId);
    
    return {
      status: result.status,
      timestamp: result.timestamp,
      dependencies: {
        dynamodb: result.status,
      },
    };
  }

  private async validateS3Uri(s3Uri: string, correlationId: string): Promise<void> {
    const s3UriRegex = /^s3:\/\/([^\/]+)\/(.+)$/;
    const match = s3Uri.match(s3UriRegex);

    if (!match) {
      throw new ModelRegistryError(
        ErrorType.VALIDATION_ERROR,
        'Invalid S3 URI format. Expected format: s3://bucket/key',
        400
      );
    }

    const [, bucket, key] = match;

    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
    } catch (error: any) {
      if (error.name === 'NotFound') {
        throw new ModelRegistryError(
          ErrorType.VALIDATION_ERROR,
          `S3 object not found: ${s3Uri}`,
          400
        );
      }
      // Log but don't fail for other S3 errors (permissions, etc.)
      this.logger.warn('S3 validation warning', {
        correlationId,
        s3Uri,
        error: error.message,
      });
    }
  }

  private async checkDuplicateVersion(modelId: string, version: string, correlationId: string): Promise<void> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `MODEL#${modelId}`,
          SK: `VERSION#${version}`,
        },
      });

      const result = await this.dynamoClient.send(command);

      if (result.Item) {
        throw new ModelRegistryError(
          ErrorType.DUPLICATE_RESOURCE,
          `Model version ${version} already exists`,
          409
        );
      }
    } catch (error) {
      if (error instanceof ModelRegistryError) {
        throw error;
      }
      // Log but don't fail for other DynamoDB errors
      this.logger.warn('Duplicate check warning', {
        correlationId,
        modelId,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private generateModelId(modelName: string): string {
    // Create a URL-safe model ID from the model name
    return modelName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }


}