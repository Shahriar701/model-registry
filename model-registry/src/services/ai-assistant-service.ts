import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../utils/logger';
import { ModelRegistration, ModelFramework, DeploymentTarget, ModelStatus } from '../types/model-types';
import { ModelRegistryError, ErrorType } from '../utils/error-handler';

export interface AIModelData {
  modelId: string;
  modelName: string;
  version: string;
  framework: ModelFramework;
  deploymentTarget: DeploymentTarget;
  status: ModelStatus;
  teamId: string;
  description?: string;
  features?: string[];
  tags?: string[];
  accuracy?: number;
  modelSize?: number;
  trainingDataset?: string;
  hyperparameters?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  s3Uri: string;
  // AI-specific fields for better context
  searchableText: string;
  capabilities: string[];
  useCases: string[];
  performanceMetrics: Record<string, any>;
}

export interface AISearchRequest {
  query?: string;
  framework?: ModelFramework;
  deploymentTarget?: DeploymentTarget;
  teamId?: string;
  tags?: string[];
  minAccuracy?: number;
  maxModelSize?: number;
  limit?: number;
  includeDeprecated?: boolean;
}

export interface AISearchResponse {
  models: AIModelData[];
  totalCount: number;
  searchMetadata: {
    query?: string;
    appliedFilters: Record<string, any>;
    searchTime: number;
  };
}

export interface AIModelSummary {
  totalModels: number;
  modelsByFramework: Record<string, number>;
  modelsByDeploymentTarget: Record<string, number>;
  modelsByTeam: Record<string, number>;
  averageAccuracy: number;
  commonTags: string[];
  recentModels: AIModelData[];
}

export class AIAssistantService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly logger: Logger;
  private readonly tableName: string;

  constructor(dynamoClient: DynamoDBDocumentClient, tableName: string) {
    this.dynamoClient = dynamoClient;
    this.logger = new Logger();
    this.tableName = tableName;
  }

  /**
   * Get structured model data optimized for RAG operations
   */
  async getModelsForRAG(teamId?: string, correlationId?: string): Promise<AIModelData[]> {
    this.logger.info('Getting models for RAG', {
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
    const models = (result.Items || []) as ModelRegistration[];

    return models.map(model => this.transformToAIModelData(model));
  }

  /**
   * Search models with AI-optimized filtering and ranking
   */
  async searchModels(request: AISearchRequest, correlationId?: string): Promise<AISearchResponse> {
    const startTime = Date.now();
    
    this.logger.info('Searching models for AI assistant', {
      correlationId,
      query: request.query,
      framework: request.framework,
      deploymentTarget: request.deploymentTarget,
      teamId: request.teamId,
    });

    let command;
    let filterExpressions: string[] = [];
    let expressionAttributeValues: Record<string, any> = {};
    let expressionAttributeNames: Record<string, string> = {};

    // Base filter for models
    filterExpressions.push('begins_with(PK, :modelPrefix)');
    expressionAttributeValues[':modelPrefix'] = 'MODEL#';

    // Add framework filter
    if (request.framework) {
      filterExpressions.push('framework = :framework');
      expressionAttributeValues[':framework'] = request.framework;
    }

    // Add deployment target filter
    if (request.deploymentTarget) {
      filterExpressions.push('deploymentTarget = :deploymentTarget');
      expressionAttributeValues[':deploymentTarget'] = request.deploymentTarget;
    }

    // Add status filter (exclude deprecated unless explicitly requested)
    if (!request.includeDeprecated) {
      filterExpressions.push('#status <> :deprecatedStatus');
      expressionAttributeValues[':deprecatedStatus'] = ModelStatus.DEPRECATED;
      expressionAttributeNames['#status'] = 'status';
    }

    // Add accuracy filter
    if (request.minAccuracy !== undefined) {
      filterExpressions.push('metadata.accuracy >= :minAccuracy');
      expressionAttributeValues[':minAccuracy'] = request.minAccuracy;
    }

    // Add model size filter
    if (request.maxModelSize !== undefined) {
      filterExpressions.push('metadata.modelSize <= :maxModelSize');
      expressionAttributeValues[':maxModelSize'] = request.maxModelSize;
    }

    if (request.teamId) {
      // Query by team using GSI1
      command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :teamPK',
        FilterExpression: filterExpressions.length > 1 ? filterExpressions.slice(1).join(' AND ') : undefined,
        ExpressionAttributeValues: {
          ...expressionAttributeValues,
          ':teamPK': `TEAM#${request.teamId}`,
        },
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        Limit: request.limit || 50,
      });
    } else {
      // Scan all models
      command = new ScanCommand({
        TableName: this.tableName,
        FilterExpression: filterExpressions.join(' AND '),
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        Limit: request.limit || 50,
      });
    }

    const result = await this.dynamoClient.send(command);
    let models = (result.Items || []) as ModelRegistration[];

    // Transform to AI model data
    let aiModels = models.map(model => this.transformToAIModelData(model));

    // Apply text search if query is provided
    if (request.query) {
      aiModels = this.performTextSearch(aiModels, request.query);
    }

    // Apply tag filtering
    if (request.tags && request.tags.length > 0) {
      aiModels = aiModels.filter(model => 
        request.tags!.some(tag => model.tags?.includes(tag))
      );
    }

    // Sort by relevance (accuracy, recency, etc.)
    aiModels = this.sortByRelevance(aiModels, request.query);

    const searchTime = Date.now() - startTime;

    return {
      models: aiModels,
      totalCount: aiModels.length,
      searchMetadata: {
        query: request.query,
        appliedFilters: {
          framework: request.framework,
          deploymentTarget: request.deploymentTarget,
          teamId: request.teamId,
          tags: request.tags,
          minAccuracy: request.minAccuracy,
          maxModelSize: request.maxModelSize,
          includeDeprecated: request.includeDeprecated,
        },
        searchTime,
      },
    };
  }

  /**
   * Get model summary for AI assistant context
   */
  async getModelSummaryForAI(correlationId?: string): Promise<AIModelSummary> {
    this.logger.info('Getting model summary for AI assistant', { correlationId });

    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'begins_with(PK, :modelPrefix)',
      ExpressionAttributeValues: {
        ':modelPrefix': 'MODEL#',
      },
    });

    const result = await this.dynamoClient.send(command);
    const models = (result.Items || []) as ModelRegistration[];
    const aiModels = models.map(model => this.transformToAIModelData(model));

    // Calculate statistics
    const frameworkCounts: Record<string, number> = {};
    const deploymentTargetCounts: Record<string, number> = {};
    const teamCounts: Record<string, number> = {};
    const allTags: string[] = [];
    let totalAccuracy = 0;
    let accuracyCount = 0;

    aiModels.forEach(model => {
      frameworkCounts[model.framework] = (frameworkCounts[model.framework] || 0) + 1;
      deploymentTargetCounts[model.deploymentTarget] = (deploymentTargetCounts[model.deploymentTarget] || 0) + 1;
      teamCounts[model.teamId] = (teamCounts[model.teamId] || 0) + 1;
      
      if (model.tags) {
        allTags.push(...model.tags);
      }
      
      if (model.accuracy !== undefined) {
        totalAccuracy += model.accuracy;
        accuracyCount++;
      }
    });

    // Get most common tags
    const tagCounts: Record<string, number> = {};
    allTags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
    
    const commonTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag]) => tag);

    // Get recent models (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentModels = aiModels
      .filter(model => new Date(model.createdAt) > thirtyDaysAgo)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    return {
      totalModels: aiModels.length,
      modelsByFramework: frameworkCounts,
      modelsByDeploymentTarget: deploymentTargetCounts,
      modelsByTeam: teamCounts,
      averageAccuracy: accuracyCount > 0 ? totalAccuracy / accuracyCount : 0,
      commonTags,
      recentModels,
    };
  }

  /**
   * Get model by ID with AI-optimized format
   */
  async getModelForAI(modelId: string, version?: string, correlationId?: string): Promise<AIModelData | null> {
    this.logger.info('Getting model for AI assistant', {
      correlationId,
      modelId,
      version,
    });

    let command;
    if (version) {
      // Get specific version
      command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': `MODEL#${modelId}`,
          ':sk': `VERSION#${version}`,
        },
      });
    } else {
      // Get all versions and return the latest
      command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `MODEL#${modelId}`,
        },
        ScanIndexForward: false, // Sort by SK descending (newest first)
        Limit: 1,
      });
    }

    const result = await this.dynamoClient.send(command);
    
    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    const model = result.Items[0] as ModelRegistration;
    return this.transformToAIModelData(model);
  }

  /**
   * Transform ModelRegistration to AI-optimized format
   */
  private transformToAIModelData(model: ModelRegistration): AIModelData {
    const metadata = model.metadata || {};
    
    // Create searchable text for better AI context
    const searchableText = [
      model.modelName,
      model.framework,
      model.deploymentTarget,
      metadata.description,
      ...(metadata.features || []),
      ...(metadata.tags || []),
      metadata.trainingDataset,
    ].filter(Boolean).join(' ').toLowerCase();

    // Infer capabilities from framework and metadata
    const capabilities = this.inferCapabilities(model.framework, metadata);
    
    // Infer use cases from tags and description
    const useCases = this.inferUseCases(metadata);

    // Extract performance metrics
    const performanceMetrics: Record<string, any> = {};
    if (metadata.accuracy !== undefined) performanceMetrics.accuracy = metadata.accuracy;
    if (metadata.modelSize !== undefined) performanceMetrics.modelSize = metadata.modelSize;
    if (metadata.hyperparameters) performanceMetrics.hyperparameters = metadata.hyperparameters;

    return {
      modelId: model.modelId,
      modelName: model.modelName,
      version: model.version,
      framework: model.framework,
      deploymentTarget: model.deploymentTarget,
      status: model.status,
      teamId: model.teamId,
      description: metadata.description,
      features: metadata.features,
      tags: metadata.tags,
      accuracy: metadata.accuracy,
      modelSize: metadata.modelSize,
      trainingDataset: metadata.trainingDataset,
      hyperparameters: metadata.hyperparameters,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      s3Uri: model.s3Uri,
      searchableText,
      capabilities,
      useCases,
      performanceMetrics,
    };
  }

  /**
   * Perform text search on AI model data
   */
  private performTextSearch(models: AIModelData[], query: string): AIModelData[] {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 0);

    return models.filter(model => {
      const searchText = model.searchableText;
      return queryTerms.some(term => searchText.includes(term));
    });
  }

  /**
   * Sort models by relevance for AI consumption
   */
  private sortByRelevance(models: AIModelData[], query?: string): AIModelData[] {
    return models.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // Boost deployed models
      if (a.status === ModelStatus.DEPLOYED) scoreA += 10;
      if (b.status === ModelStatus.DEPLOYED) scoreB += 10;

      // Boost models with higher accuracy
      if (a.accuracy !== undefined) scoreA += a.accuracy * 5;
      if (b.accuracy !== undefined) scoreB += b.accuracy * 5;

      // Boost more recent models
      const aAge = Date.now() - new Date(a.createdAt).getTime();
      const bAge = Date.now() - new Date(b.createdAt).getTime();
      const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year in ms
      scoreA += Math.max(0, (maxAge - aAge) / maxAge) * 5;
      scoreB += Math.max(0, (maxAge - bAge) / maxAge) * 5;

      // If query provided, boost exact matches
      if (query) {
        const queryLower = query.toLowerCase();
        if (a.modelName.toLowerCase().includes(queryLower)) scoreA += 20;
        if (b.modelName.toLowerCase().includes(queryLower)) scoreB += 20;
        if (a.description?.toLowerCase().includes(queryLower)) scoreA += 10;
        if (b.description?.toLowerCase().includes(queryLower)) scoreB += 10;
      }

      return scoreB - scoreA;
    });
  }

  /**
   * Infer model capabilities from framework and metadata
   */
  private inferCapabilities(framework: ModelFramework, metadata: any): string[] {
    const capabilities: string[] = [];

    // Framework-based capabilities
    switch (framework) {
      case ModelFramework.TENSORFLOW:
        capabilities.push('deep learning', 'neural networks', 'computer vision', 'nlp');
        break;
      case ModelFramework.PYTORCH:
        capabilities.push('deep learning', 'neural networks', 'research', 'computer vision');
        break;
      case ModelFramework.SCIKIT_LEARN:
        capabilities.push('machine learning', 'classification', 'regression', 'clustering');
        break;
      case ModelFramework.XGBOOST:
        capabilities.push('gradient boosting', 'tabular data', 'classification', 'regression');
        break;
      case ModelFramework.LIGHTGBM:
        capabilities.push('gradient boosting', 'fast training', 'tabular data');
        break;
      case ModelFramework.HUGGINGFACE:
        capabilities.push('transformers', 'nlp', 'text generation', 'language models');
        break;
      case ModelFramework.ONNX:
        capabilities.push('cross-platform', 'model optimization', 'inference');
        break;
    }

    // Metadata-based capabilities
    if (metadata.features) {
      if (metadata.features.some((f: string) => f.toLowerCase().includes('image'))) {
        capabilities.push('computer vision');
      }
      if (metadata.features.some((f: string) => f.toLowerCase().includes('text'))) {
        capabilities.push('nlp');
      }
    }

    return [...new Set(capabilities)]; // Remove duplicates
  }

  /**
   * Infer use cases from metadata
   */
  private inferUseCases(metadata: any): string[] {
    const useCases: string[] = [];

    // From tags
    if (metadata.tags) {
      metadata.tags.forEach((tag: string) => {
        const tagLower = tag.toLowerCase();
        if (tagLower.includes('fraud')) useCases.push('fraud detection');
        if (tagLower.includes('recommendation')) useCases.push('recommendation system');
        if (tagLower.includes('classification')) useCases.push('classification');
        if (tagLower.includes('prediction')) useCases.push('prediction');
        if (tagLower.includes('sentiment')) useCases.push('sentiment analysis');
        if (tagLower.includes('vision')) useCases.push('computer vision');
      });
    }

    // From description
    if (metadata.description) {
      const descLower = metadata.description.toLowerCase();
      if (descLower.includes('predict')) useCases.push('prediction');
      if (descLower.includes('classify')) useCases.push('classification');
      if (descLower.includes('detect')) useCases.push('detection');
      if (descLower.includes('recommend')) useCases.push('recommendation');
    }

    return [...new Set(useCases)]; // Remove duplicates
  }
}