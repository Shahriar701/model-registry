import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ModelRegistryService } from './model-registry-service';
import { Logger } from './utils/logger';
import { ErrorHandler, ErrorType } from './utils/error-handler';
import { ValidationService } from './validation/validation-service';
import { DeploymentTarget, ModelFramework, ModelStatus } from './types/model-types';

const logger = new Logger();
const modelRegistryService = new ModelRegistryService();
const errorHandler = new ErrorHandler();
const validationService = new ValidationService();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const correlationId = event.headers['X-Correlation-ID'] || event.headers['x-correlation-id'] || generateCorrelationId();
  
  logger.info('Processing model registry request', {
    correlationId,
    httpMethod: event.httpMethod,
    resource: event.resource,
    pathParameters: event.pathParameters,
  });

  try {
    const { httpMethod, resource, pathParameters, queryStringParameters, body } = event;
    const route = `${httpMethod} ${resource}`;

    switch (route) {
      case 'POST /api/v1/models':
        return await registerModel(event, correlationId);
      
      case 'GET /api/v1/models':
        return await listModels(event, correlationId);
      
      case 'GET /api/v1/models/{modelId}':
        return await getModelVersions(event, correlationId);
      
      case 'GET /api/v1/models/{modelId}/{version}':
        return await getModelVersion(event, correlationId);
      
      case 'GET /api/v1/models/{modelId}/latest':
        return await getLatestModelVersion(event, correlationId);
      
      case 'PUT /api/v1/models/{modelId}/{version}':
        return await updateModelMetadata(event, correlationId);
      
      case 'DELETE /api/v1/models/{modelId}/{version}':
        return await deregisterModel(event, correlationId);
      
      case 'POST /api/v1/models/{modelId}/{version}/deploy':
        return await triggerDeployment(event, correlationId);
      
      case 'GET /api/v1/health':
        return await healthCheck(correlationId);
      
      case 'GET /api/v1/statistics':
        return await getModelStatistics(event, correlationId);
      
      default:
        return errorHandler.createErrorResponse(
          ErrorType.RESOURCE_NOT_FOUND,
          `Route not found: ${route}`,
          404,
          correlationId
        );
    }
  } catch (error) {
    logger.error('Unhandled error in model registry handler', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorHandler.handleError(error, correlationId);
  }
};

async function registerModel(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const requestBody = JSON.parse(event.body || '{}');
    
    // Validate request
    const validationResult = validationService.validateRegisterModelRequest(requestBody);
    if (!validationResult.isValid) {
      return errorHandler.createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Invalid request data',
        400,
        correlationId,
        validationResult.errors
      );
    }

    // Extract team ID from authorizer context (if available)
    const teamId = event.requestContext.authorizer?.teamId || 'default-team';

    const result = await modelRegistryService.registerModel({
      ...requestBody,
      teamId,
    }, correlationId);

    logger.info('Model registered successfully', {
      correlationId,
      modelId: result.modelId,
      modelName: requestBody.modelName,
      version: requestBody.version,
    });

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function listModels(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const queryParams = event.queryStringParameters || {};
    const teamId = event.requestContext.authorizer?.teamId;

    // Validate query parameters
    const validationResults = [
      validationService.validatePaginationParams(queryParams.limit, queryParams.nextToken),
      validationService.validateDeploymentTarget(queryParams.deploymentTarget),
      validationService.validateFramework(queryParams.framework),
      validationService.validateModelStatus(queryParams.status),
      validationService.validateNamePattern(queryParams.namePattern),
    ];

    const errors: Record<string, string> = {};
    validationResults.forEach(result => {
      if (!result.isValid && result.errors) {
        Object.assign(errors, result.errors);
      }
    });

    if (Object.keys(errors).length > 0) {
      return errorHandler.createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Invalid query parameters',
        400,
        correlationId,
        errors
      );
    }

    const result = await modelRegistryService.listModels({
      limit: queryParams.limit ? parseInt(queryParams.limit) : undefined,
      nextToken: queryParams.nextToken,
      teamId: queryParams.teamId || teamId,
      deploymentTarget: queryParams.deploymentTarget as DeploymentTarget,
      namePattern: queryParams.namePattern,
      framework: queryParams.framework as ModelFramework,
      status: queryParams.status as ModelStatus,
    }, correlationId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function getModelVersions(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const { modelId } = event.pathParameters!;
    const teamId = event.requestContext.authorizer?.teamId;

    const result = await modelRegistryService.getModelVersions(modelId!, teamId, correlationId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function getModelVersion(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const { modelId, version } = event.pathParameters!;
    const teamId = event.requestContext.authorizer?.teamId;

    const result = await modelRegistryService.getModelVersion(modelId!, version!, teamId, correlationId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function getLatestModelVersion(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const { modelId } = event.pathParameters!;
    const teamId = event.requestContext.authorizer?.teamId;

    const result = await modelRegistryService.getLatestModelVersion(modelId!, teamId, correlationId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function updateModelMetadata(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const { modelId, version } = event.pathParameters!;
    const requestBody = JSON.parse(event.body || '{}');
    const teamId = event.requestContext.authorizer?.teamId;

    const result = await modelRegistryService.updateModelMetadata(
      modelId!,
      version!,
      requestBody,
      teamId,
      correlationId
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function deregisterModel(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const { modelId, version } = event.pathParameters!;
    const teamId = event.requestContext.authorizer?.teamId;

    await modelRegistryService.deregisterModel(modelId!, version!, teamId, correlationId);

    return {
      statusCode: 204,
      headers: {
        'X-Correlation-ID': correlationId,
      },
      body: '',
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function triggerDeployment(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const { modelId, version } = event.pathParameters!;
    const teamId = event.requestContext.authorizer?.teamId;

    const result = await modelRegistryService.triggerDeployment(modelId!, version!, teamId, correlationId);

    return {
      statusCode: 202,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function getModelStatistics(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const teamId = event.requestContext.authorizer?.teamId;
    const queryParams = event.queryStringParameters || {};
    
    // Allow admin users to get statistics for specific teams or all teams
    const requestedTeamId = queryParams.teamId || teamId;

    const statistics = await modelRegistryService.getModelStatistics(requestedTeamId, correlationId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(statistics),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

async function healthCheck(correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const health = await modelRegistryService.healthCheck(correlationId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(health),
    };
  } catch (error) {
    return errorHandler.handleError(error, correlationId);
  }
}

function generateCorrelationId(): string {
  return `mr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}