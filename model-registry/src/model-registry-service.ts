import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Logger } from './utils/logger';
import { ModelRegistration, RegisterModelRequest, ListModelsRequest, ListModelsResponse, ModelSummary, DeploymentTriggerResponse, ModelStatus } from './types/model-types';
import { ModelRegistryError, ErrorType } from './utils/error-handler';
import { VersionUtils } from './utils/version-utils';

export class ModelRegistryService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly s3Client: S3Client;
  private readonly logger: Logger;
  private readonly tableName: string;

  constructor() {
    const dynamoDBClient = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(dynamoDBClient);
    this.cloudWatchClient = new CloudWatchClient({});
    this.s3Client = new S3Client({});
    this.logger = new Logger();
    this.tableName = process.env.MODELS_TABLE_NAME!;

    if (!this.tableName) {
      throw new Error('MODELS_TABLE_NAME environment variable is required');
    }
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
      await this.dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: modelRegistration,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }));

      // Emit CloudWatch metrics
      await this.emitMetrics('ModelRegistered', 1, {
        TeamId: request.teamId,
        Framework: request.framework,
        DeploymentTarget: request.deploymentTarget,
      }, correlationId);

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

  async getModelVersions(modelId: string, teamId: string | undefined, correlationId: string): Promise<ModelRegistration[]> {
    this.logger.info('Getting model versions', {
      correlationId,
      modelId,
      teamId,
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

    // Filter by team if specified
    const filteredItems = teamId 
      ? result.Items.filter(item => item.teamId === teamId)
      : result.Items;

    if (filteredItems.length === 0) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `Model ${modelId} not found for team ${teamId}`,
        404
      );
    }

    return filteredItems as ModelRegistration[];
  }

  async getModelVersion(modelId: string, version: string, teamId: string | undefined, correlationId: string): Promise<ModelRegistration> {
    this.logger.info('Getting model version', {
      correlationId,
      modelId,
      version,
      teamId,
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

    // Check team access if specified
    if (teamId && result.Item.teamId !== teamId) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `Model ${modelId} version ${version} not found for team ${teamId}`,
        404
      );
    }

    return result.Item as ModelRegistration;
  }

  async getLatestModelVersion(modelId: string, teamId: string | undefined, correlationId: string): Promise<ModelRegistration> {
    this.logger.info('Getting latest model version', {
      correlationId,
      modelId,
      teamId,
    });

    // Get all versions of the model
    const versions = await this.getModelVersions(modelId, teamId, correlationId);

    if (versions.length === 0) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `No versions found for model ${modelId}`,
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

  async updateModelMetadata(modelId: string, version: string, metadata: any, teamId: string | undefined, correlationId: string): Promise<ModelRegistration> {
    this.logger.info('Updating model metadata', {
      correlationId,
      modelId,
      version,
      teamId,
    });

    // First, verify the model exists and team has access
    await this.getModelVersion(modelId, version, teamId, correlationId);

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

  async deregisterModel(modelId: string, version: string, teamId: string | undefined, correlationId: string): Promise<void> {
    this.logger.info('Deregistering model', {
      correlationId,
      modelId,
      version,
      teamId,
    });

    // First, verify the model exists and team has access
    await this.getModelVersion(modelId, version, teamId, correlationId);

    const command = new DeleteCommand({
      TableName: this.tableName,
      Key: {
        PK: `MODEL#${modelId}`,
        SK: `VERSION#${version}`,
      },
    });

    await this.dynamoClient.send(command);

    // Emit CloudWatch metrics
    await this.emitMetrics('ModelDeregistered', 1, {
      TeamId: teamId || 'unknown',
    }, correlationId);
  }

  async triggerDeployment(modelId: string, version: string, teamId: string | undefined, correlationId: string): Promise<DeploymentTriggerResponse> {
    this.logger.info('Triggering deployment', {
      correlationId,
      modelId,
      version,
      teamId,
    });

    // Get model details
    const model = await this.getModelVersion(modelId, version, teamId, correlationId);

    // Update model status to DEPLOYING
    const timestamp = new Date().toISOString();
    await this.dynamoClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: {
        PK: `MODEL#${modelId}`,
        SK: `VERSION#${version}`,
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': ModelStatus.DEPLOYING,
        ':updatedAt': timestamp,
      },
    }));

    // Generate deployment ID
    const deploymentId = `deploy-${modelId}-${version}-${Date.now()}`;

    // TODO: Publish deployment event to EventBridge
    // This would trigger the actual deployment pipeline

    // Emit CloudWatch metrics
    await this.emitMetrics('DeploymentTriggered', 1, {
      TeamId: model.teamId,
      DeploymentTarget: model.deploymentTarget,
    }, correlationId);

    return {
      deploymentId,
      message: 'Deployment initiated',
      status: ModelStatus.DEPLOYING,
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

  async healthCheck(correlationId: string): Promise<{ status: string; timestamp: string; dependencies: any }> {
    this.logger.info('Health check requested', { correlationId });

    const timestamp = new Date().toISOString();
    const dependencies: any = {};

    // Check DynamoDB connectivity
    try {
      await this.dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: 'HEALTH_CHECK',
          SK: 'HEALTH_CHECK',
        },
      }));
      dependencies.dynamodb = 'healthy';
    } catch (error) {
      dependencies.dynamodb = 'unhealthy';
    }

    const overallStatus = Object.values(dependencies).every(status => status === 'healthy') ? 'healthy' : 'unhealthy';

    return {
      status: overallStatus,
      timestamp,
      dependencies,
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

  private async emitMetrics(metricName: string, value: number, dimensions: Record<string, string>, correlationId: string): Promise<void> {
    try {
      const command = new PutMetricDataCommand({
        Namespace: process.env.METRICS_NAMESPACE || 'ModelRegistry',
        MetricData: [{
          MetricName: metricName,
          Value: value,
          Unit: 'Count',
          Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value })),
          Timestamp: new Date(),
        }],
      });

      await this.cloudWatchClient.send(command);
    } catch (error) {
      this.logger.warn('Failed to emit metrics', {
        correlationId,
        metricName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}