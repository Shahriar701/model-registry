import { DynamoDBDocumentClient, UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '../utils/logger';
import { ModelStatus, DeploymentTarget } from '../types/model-types';
import { ModelRegistryError, ErrorType } from '../utils/error-handler';

export interface DeploymentEvent {
  deploymentId: string;
  modelId: string;
  version: string;
  status: DeploymentStatus;
  deploymentTarget: DeploymentTarget;
  teamId: string;
  timestamp: string;
  metadata?: Record<string, any>;
  error?: string;
}

export interface DeploymentHistory {
  PK: string; // DEPLOYMENT#{deploymentId}
  SK: string; // EVENT#{timestamp}
  deploymentId: string;
  modelId: string;
  version: string;
  eventType: DeploymentEventType;
  status: DeploymentStatus;
  deploymentTarget: DeploymentTarget;
  teamId: string;
  timestamp: string;
  metadata?: Record<string, any>;
  error?: string;
  // GSI keys for querying
  GSI1PK: string; // MODEL#{modelId}#VERSION#{version}
  GSI1SK: string; // DEPLOYMENT#{deploymentId}#{timestamp}
}

export enum DeploymentStatus {
  INITIATED = 'INITIATED',
  IN_PROGRESS = 'IN_PROGRESS',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
  CANCELLED = 'CANCELLED',
}

export enum DeploymentEventType {
  DEPLOYMENT_INITIATED = 'DEPLOYMENT_INITIATED',
  DEPLOYMENT_STARTED = 'DEPLOYMENT_STARTED',
  DEPLOYMENT_PROGRESS = 'DEPLOYMENT_PROGRESS',
  DEPLOYMENT_COMPLETED = 'DEPLOYMENT_COMPLETED',
  DEPLOYMENT_FAILED = 'DEPLOYMENT_FAILED',
  DEPLOYMENT_ROLLED_BACK = 'DEPLOYMENT_ROLLED_BACK',
  DEPLOYMENT_CANCELLED = 'DEPLOYMENT_CANCELLED',
}

export interface DeploymentStatusUpdate {
  deploymentId: string;
  status: DeploymentStatus;
  metadata?: Record<string, any>;
  error?: string;
}

export interface DeploymentTriggerRequest {
  modelId: string;
  version: string;
  deploymentTarget: DeploymentTarget;
  teamId: string;
  metadata?: Record<string, any>;
}

export interface DeploymentTriggerResponse {
  deploymentId: string;
  status: DeploymentStatus;
  message: string;
  eventBridgeMessageId?: string;
}

export interface DeploymentHistoryQuery {
  modelId?: string;
  version?: string;
  deploymentId?: string;
  teamId?: string;
  status?: DeploymentStatus;
  deploymentTarget?: DeploymentTarget;
  startDate?: string;
  endDate?: string;
  limit?: number;
  nextToken?: string;
}

export interface DeploymentHistoryResponse {
  deployments: DeploymentHistory[];
  pagination: {
    nextToken?: string;
    totalCount: number;
  };
}

export class DeploymentPipelineService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly eventBridgeClient: EventBridgeClient;
  private readonly logger: Logger;
  private readonly modelsTableName: string;
  private readonly eventBusName: string;

  constructor(
    dynamoClient: DynamoDBDocumentClient,
    modelsTableName: string,
    eventBusName?: string
  ) {
    this.dynamoClient = dynamoClient;
    this.eventBridgeClient = new EventBridgeClient({});
    this.logger = new Logger();
    this.modelsTableName = modelsTableName;
    this.eventBusName = eventBusName || 'default';
  }

  /**
   * Trigger a deployment and publish event to EventBridge
   */
  async triggerDeployment(
    request: DeploymentTriggerRequest,
    correlationId: string
  ): Promise<DeploymentTriggerResponse> {
    const deploymentId = this.generateDeploymentId(request.modelId, request.version);
    const timestamp = new Date().toISOString();

    this.logger.info('Triggering deployment', {
      correlationId,
      deploymentId,
      modelId: request.modelId,
      version: request.version,
      deploymentTarget: request.deploymentTarget,
      teamId: request.teamId,
    });

    try {
      // Update model status to DEPLOYING
      await this.updateModelStatus(
        request.modelId,
        request.version,
        ModelStatus.DEPLOYING,
        correlationId
      );

      // Record deployment initiation in history
      await this.recordDeploymentEvent({
        deploymentId,
        modelId: request.modelId,
        version: request.version,
        status: DeploymentStatus.INITIATED,
        deploymentTarget: request.deploymentTarget,
        teamId: request.teamId,
        timestamp,
        metadata: request.metadata,
      }, correlationId);

      // Publish deployment event to EventBridge
      const eventBridgeResponse = await this.publishDeploymentEvent({
        deploymentId,
        modelId: request.modelId,
        version: request.version,
        status: DeploymentStatus.INITIATED,
        deploymentTarget: request.deploymentTarget,
        teamId: request.teamId,
        timestamp,
        metadata: {
          ...request.metadata,
          correlationId,
          source: 'model-registry',
        },
      }, correlationId);

      this.logger.info('Deployment triggered successfully', {
        correlationId,
        deploymentId,
        eventBridgeMessageId: eventBridgeResponse.Entries?.[0]?.EventId,
      });

      return {
        deploymentId,
        status: DeploymentStatus.INITIATED,
        message: 'Deployment initiated successfully',
        eventBridgeMessageId: eventBridgeResponse.Entries?.[0]?.EventId,
      };
    } catch (error) {
      this.logger.error('Failed to trigger deployment', {
        correlationId,
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Record failure in deployment history
      await this.recordDeploymentEvent({
        deploymentId,
        modelId: request.modelId,
        version: request.version,
        status: DeploymentStatus.FAILED,
        deploymentTarget: request.deploymentTarget,
        teamId: request.teamId,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }, correlationId);

      throw error;
    }
  }

  /**
   * Update deployment status (called by deployment pipelines via webhook)
   */
  async updateDeploymentStatus(
    update: DeploymentStatusUpdate,
    correlationId: string
  ): Promise<void> {
    this.logger.info('Updating deployment status', {
      correlationId,
      deploymentId: update.deploymentId,
      status: update.status,
    });

    // Get deployment info from history to update model status
    const deploymentInfo = await this.getDeploymentInfo(update.deploymentId, correlationId);
    
    if (!deploymentInfo) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `Deployment ${update.deploymentId} not found`,
        404
      );
    }

    // Update model status based on deployment status
    let modelStatus: ModelStatus;
    switch (update.status) {
      case DeploymentStatus.DEPLOYED:
        modelStatus = ModelStatus.DEPLOYED;
        break;
      case DeploymentStatus.FAILED:
      case DeploymentStatus.CANCELLED:
        modelStatus = ModelStatus.FAILED;
        break;
      case DeploymentStatus.ROLLED_BACK:
        modelStatus = ModelStatus.REGISTERED; // Back to registered state
        break;
      default:
        modelStatus = ModelStatus.DEPLOYING; // Keep deploying for in-progress states
    }

    // Update model status
    await this.updateModelStatus(
      deploymentInfo.modelId,
      deploymentInfo.version,
      modelStatus,
      correlationId
    );

    // Record deployment status update in history
    await this.recordDeploymentEvent({
      deploymentId: update.deploymentId,
      modelId: deploymentInfo.modelId,
      version: deploymentInfo.version,
      status: update.status,
      deploymentTarget: deploymentInfo.deploymentTarget,
      teamId: deploymentInfo.teamId,
      timestamp: new Date().toISOString(),
      metadata: update.metadata,
      error: update.error,
    }, correlationId);

    this.logger.info('Deployment status updated successfully', {
      correlationId,
      deploymentId: update.deploymentId,
      status: update.status,
      modelStatus,
    });
  }

  /**
   * Get deployment history for a model or deployment
   */
  async getDeploymentHistory(
    query: DeploymentHistoryQuery,
    correlationId: string
  ): Promise<DeploymentHistoryResponse> {
    this.logger.info('Getting deployment history', {
      correlationId,
      query,
    });

    let command;
    const limit = Math.min(query.limit || 50, 100);

    if (query.deploymentId) {
      // Query specific deployment history
      command = new QueryCommand({
        TableName: this.modelsTableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `DEPLOYMENT#${query.deploymentId}`,
        },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
        ExclusiveStartKey: query.nextToken ? JSON.parse(Buffer.from(query.nextToken, 'base64').toString()) : undefined,
      });
    } else if (query.modelId && query.version) {
      // Query deployment history for specific model version using GSI
      command = new QueryCommand({
        TableName: this.modelsTableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': `MODEL#${query.modelId}#VERSION#${query.version}`,
        },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
        ExclusiveStartKey: query.nextToken ? JSON.parse(Buffer.from(query.nextToken, 'base64').toString()) : undefined,
      });
    } else {
      throw new ModelRegistryError(
        ErrorType.VALIDATION_ERROR,
        'Either deploymentId or both modelId and version must be provided',
        400
      );
    }

    const result = await this.dynamoClient.send(command);
    let deployments = (result.Items || []) as DeploymentHistory[];

    // Apply additional filters
    if (query.status) {
      deployments = deployments.filter(d => d.status === query.status);
    }

    if (query.deploymentTarget) {
      deployments = deployments.filter(d => d.deploymentTarget === query.deploymentTarget);
    }

    if (query.teamId) {
      deployments = deployments.filter(d => d.teamId === query.teamId);
    }

    if (query.startDate) {
      deployments = deployments.filter(d => d.timestamp >= query.startDate!);
    }

    if (query.endDate) {
      deployments = deployments.filter(d => d.timestamp <= query.endDate!);
    }

    const nextToken = result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    return {
      deployments,
      pagination: {
        nextToken,
        totalCount: deployments.length,
      },
    };
  }

  /**
   * Get current deployment status for a model version
   */
  async getCurrentDeploymentStatus(
    modelId: string,
    version: string,
    correlationId: string
  ): Promise<DeploymentHistory | null> {
    this.logger.info('Getting current deployment status', {
      correlationId,
      modelId,
      version,
    });

    const command = new QueryCommand({
      TableName: this.modelsTableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `MODEL#${modelId}#VERSION#${version}`,
      },
      ScanIndexForward: false, // Most recent first
      Limit: 1,
    });

    const result = await this.dynamoClient.send(command);
    
    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return result.Items[0] as DeploymentHistory;
  }

  /**
   * Cancel a deployment
   */
  async cancelDeployment(
    deploymentId: string,
    reason: string,
    correlationId: string
  ): Promise<void> {
    this.logger.info('Cancelling deployment', {
      correlationId,
      deploymentId,
      reason,
    });

    const deploymentInfo = await this.getDeploymentInfo(deploymentId, correlationId);
    
    if (!deploymentInfo) {
      throw new ModelRegistryError(
        ErrorType.RESOURCE_NOT_FOUND,
        `Deployment ${deploymentId} not found`,
        404
      );
    }

    // Update deployment status to cancelled
    await this.updateDeploymentStatus({
      deploymentId,
      status: DeploymentStatus.CANCELLED,
      metadata: { reason },
    }, correlationId);

    // Publish cancellation event to EventBridge
    await this.publishDeploymentEvent({
      deploymentId,
      modelId: deploymentInfo.modelId,
      version: deploymentInfo.version,
      status: DeploymentStatus.CANCELLED,
      deploymentTarget: deploymentInfo.deploymentTarget,
      teamId: deploymentInfo.teamId,
      timestamp: new Date().toISOString(),
      metadata: { reason, correlationId },
    }, correlationId);
  }

  /**
   * Record deployment event in history table
   */
  private async recordDeploymentEvent(
    event: DeploymentEvent,
    correlationId: string
  ): Promise<void> {
    const eventType = this.getEventTypeFromStatus(event.status);
    
    const deploymentHistory: DeploymentHistory = {
      PK: `DEPLOYMENT#${event.deploymentId}`,
      SK: `EVENT#${event.timestamp}`,
      deploymentId: event.deploymentId,
      modelId: event.modelId,
      version: event.version,
      eventType,
      status: event.status,
      deploymentTarget: event.deploymentTarget,
      teamId: event.teamId,
      timestamp: event.timestamp,
      metadata: event.metadata,
      error: event.error,
      GSI1PK: `MODEL#${event.modelId}#VERSION#${event.version}`,
      GSI1SK: `DEPLOYMENT#${event.deploymentId}#${event.timestamp}`,
    };

    await this.dynamoClient.send(new PutCommand({
      TableName: this.modelsTableName,
      Item: deploymentHistory,
    }));

    this.logger.info('Deployment event recorded', {
      correlationId,
      deploymentId: event.deploymentId,
      eventType,
      status: event.status,
    });
  }

  /**
   * Publish deployment event to EventBridge
   */
  private async publishDeploymentEvent(
    event: DeploymentEvent,
    correlationId: string
  ): Promise<any> {
    const eventDetail = {
      deploymentId: event.deploymentId,
      modelId: event.modelId,
      version: event.version,
      status: event.status,
      deploymentTarget: event.deploymentTarget,
      teamId: event.teamId,
      timestamp: event.timestamp,
      metadata: event.metadata,
      error: event.error,
    };

    const command = new PutEventsCommand({
      Entries: [
        {
          Source: 'model-registry',
          DetailType: 'Model Deployment Event',
          Detail: JSON.stringify(eventDetail),
          EventBusName: this.eventBusName,
          Resources: [
            `model:${event.modelId}:${event.version}`,
            `deployment:${event.deploymentId}`,
            `team:${event.teamId}`,
          ],
        },
      ],
    });

    const result = await this.eventBridgeClient.send(command);
    
    this.logger.info('Deployment event published to EventBridge', {
      correlationId,
      deploymentId: event.deploymentId,
      eventId: result.Entries?.[0]?.EventId,
      status: event.status,
    });

    return result;
  }

  /**
   * Update model status in the models table
   */
  private async updateModelStatus(
    modelId: string,
    version: string,
    status: ModelStatus,
    correlationId: string
  ): Promise<void> {
    const command = new UpdateCommand({
      TableName: this.modelsTableName,
      Key: {
        PK: `MODEL#${modelId}`,
        SK: `VERSION#${version}`,
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': new Date().toISOString(),
      },
    });

    await this.dynamoClient.send(command);

    this.logger.info('Model status updated', {
      correlationId,
      modelId,
      version,
      status,
    });
  }

  /**
   * Get deployment info from the most recent deployment event
   */
  private async getDeploymentInfo(
    deploymentId: string,
    correlationId: string
  ): Promise<DeploymentHistory | null> {
    const command = new QueryCommand({
      TableName: this.modelsTableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `DEPLOYMENT#${deploymentId}`,
      },
      ScanIndexForward: false, // Most recent first
      Limit: 1,
    });

    const result = await this.dynamoClient.send(command);
    
    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return result.Items[0] as DeploymentHistory;
  }

  /**
   * Generate unique deployment ID
   */
  private generateDeploymentId(modelId: string, version: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 6);
    return `deploy-${modelId}-${version}-${timestamp}-${random}`;
  }

  /**
   * Map deployment status to event type
   */
  private getEventTypeFromStatus(status: DeploymentStatus): DeploymentEventType {
    switch (status) {
      case DeploymentStatus.INITIATED:
        return DeploymentEventType.DEPLOYMENT_INITIATED;
      case DeploymentStatus.IN_PROGRESS:
      case DeploymentStatus.DEPLOYING:
        return DeploymentEventType.DEPLOYMENT_STARTED;
      case DeploymentStatus.DEPLOYED:
        return DeploymentEventType.DEPLOYMENT_COMPLETED;
      case DeploymentStatus.FAILED:
        return DeploymentEventType.DEPLOYMENT_FAILED;
      case DeploymentStatus.ROLLED_BACK:
        return DeploymentEventType.DEPLOYMENT_ROLLED_BACK;
      case DeploymentStatus.CANCELLED:
        return DeploymentEventType.DEPLOYMENT_CANCELLED;
      default:
        return DeploymentEventType.DEPLOYMENT_PROGRESS;
    }
  }
}