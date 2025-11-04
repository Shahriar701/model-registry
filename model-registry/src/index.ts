import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ModelRegistryService } from './model-registry-service';
import { Logger } from './utils/logger';
import { ErrorHandler, ErrorType } from './utils/error-handler';
import { ValidationService } from './validation/validation-service';
import { DeploymentTarget, ModelFramework, ModelStatus } from './types/model-types';
import { AuthMiddleware, AuthContext } from './auth';
import { AuditMiddleware } from './audit';

const logger = new Logger();
const modelRegistryService = new ModelRegistryService();
const errorHandler = new ErrorHandler();
const validationService = new ValidationService();
const authMiddleware = new AuthMiddleware();
const auditMiddleware = new AuditMiddleware();

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
  let authContext: AuthContext | undefined;
  let modelId: string | undefined;
  let version: string | undefined;

  try {
    // Authenticate the request
    authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Log authentication success
    await auditMiddleware.logAuthentication(
      correlationId,
      authContext.keyId,
      authContext.teamId,
      'SUCCESS',
      event
    );
    
    // Check write permission
    authMiddleware.checkPermission(authContext, 'models:write');

    const requestBody = JSON.parse(event.body || '{}');
    modelId = requestBody.modelName; // Will be converted to modelId in service
    version = requestBody.version;
    
    // Validate request
    const validationResult = validationService.validateRegisterModelRequest(requestBody);
    if (!validationResult.isValid) {
      // Log validation failure
      if (modelId && version) {
        await auditMiddleware.logModelRegistration(
          authContext,
          correlationId,
          modelId,
          version,
          'FAILURE',
          event,
          { validationErrors: validationResult.errors }
        );
      }

      return errorHandler.createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Invalid request data',
        400,
        correlationId,
        validationResult.errors
      );
    }

    // Use authenticated team ID, but allow override for admin users
    const teamId = authMiddleware.validateTeamAccess(authContext, requestBody.teamId);

    const result = await modelRegistryService.registerModel({
      ...requestBody,
      teamId,
    }, correlationId);

    // Log successful model registration
    await auditMiddleware.logModelRegistration(
      authContext,
      correlationId,
      result.modelId,
      requestBody.version,
      'SUCCESS',
      event,
      {
        modelName: requestBody.modelName,
        framework: requestBody.framework,
        deploymentTarget: requestBody.deploymentTarget,
      }
    );

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
    // Log authentication failure if auth failed
    if (!authContext) {
      await auditMiddleware.logAuthentication(
        correlationId,
        undefined,
        undefined,
        'FAILURE',
        event,
        { error: error instanceof Error ? error.message : String(error) }
      );
    } else if (modelId && version) {
      // Log model registration failure
      await auditMiddleware.logModelRegistration(
        authContext,
        correlationId,
        modelId,
        version,
        'FAILURE',
        event,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    return errorHandler.handleError(error, correlationId);
  }
}

async function listModels(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    // Authenticate the request
    const authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check read permission
    authMiddleware.checkPermission(authContext, 'models:read');

    const queryParams = event.queryStringParameters || {};
    
    // Determine which team's models to list
    const requestedTeamId = queryParams.teamId;
    const teamId = authMiddleware.validateTeamAccess(authContext, requestedTeamId);

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
    // Authenticate the request
    const authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check read permission
    authMiddleware.checkPermission(authContext, 'models:read');

    const { modelId } = event.pathParameters!;

    const result = await modelRegistryService.getModelVersions(modelId!, authContext, correlationId);

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
  let authContext: AuthContext | undefined;
  const { modelId, version } = event.pathParameters!;

  try {
    // Authenticate the request
    authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check read permission
    authMiddleware.checkPermission(authContext, 'models:read');

    const result = await modelRegistryService.getModelVersion(modelId!, version!, authContext, correlationId);

    // Log successful model access
    await auditMiddleware.logModelAccess(
      authContext,
      correlationId,
      modelId!,
      version!,
      'SUCCESS',
      event
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
    // Log model access failure
    if (authContext && modelId && version) {
      await auditMiddleware.logModelAccess(
        authContext,
        correlationId,
        modelId,
        version,
        'FAILURE',
        event,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    return errorHandler.handleError(error, correlationId);
  }
}

async function getLatestModelVersion(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    // Authenticate the request
    const authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check read permission
    authMiddleware.checkPermission(authContext, 'models:read');

    const { modelId } = event.pathParameters!;

    const result = await modelRegistryService.getLatestModelVersion(modelId!, authContext, correlationId);

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
  let authContext: AuthContext | undefined;
  const { modelId, version } = event.pathParameters!;

  try {
    // Authenticate the request
    authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check write permission
    authMiddleware.checkPermission(authContext, 'models:write');

    const requestBody = JSON.parse(event.body || '{}');

    const result = await modelRegistryService.updateModelMetadata(
      modelId!,
      version!,
      requestBody,
      authContext,
      correlationId
    );

    // Log successful model update
    await auditMiddleware.logModelUpdate(
      authContext,
      correlationId,
      modelId!,
      version!,
      'SUCCESS',
      event,
      { updatedFields: Object.keys(requestBody) }
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
    // Log model update failure
    if (authContext && modelId && version) {
      await auditMiddleware.logModelUpdate(
        authContext,
        correlationId,
        modelId,
        version,
        'FAILURE',
        event,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    return errorHandler.handleError(error, correlationId);
  }
}

async function deregisterModel(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  let authContext: AuthContext | undefined;
  const { modelId, version } = event.pathParameters!;

  try {
    // Authenticate the request
    authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check write permission
    authMiddleware.checkPermission(authContext, 'models:write');

    await modelRegistryService.deregisterModel(modelId!, version!, authContext, correlationId);

    // Log successful model deletion
    await auditMiddleware.logModelDeletion(
      authContext,
      correlationId,
      modelId!,
      version!,
      'SUCCESS',
      event
    );

    return {
      statusCode: 204,
      headers: {
        'X-Correlation-ID': correlationId,
      },
      body: '',
    };
  } catch (error) {
    // Log model deletion failure
    if (authContext && modelId && version) {
      await auditMiddleware.logModelDeletion(
        authContext,
        correlationId,
        modelId,
        version,
        'FAILURE',
        event,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    return errorHandler.handleError(error, correlationId);
  }
}

async function triggerDeployment(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  let authContext: AuthContext | undefined;
  const { modelId, version } = event.pathParameters!;

  try {
    // Authenticate the request
    authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check deploy permission
    authMiddleware.checkPermission(authContext, 'models:deploy');

    const result = await modelRegistryService.triggerDeployment(modelId!, version!, authContext, correlationId);

    // Log successful deployment trigger
    await auditMiddleware.logModelDeployment(
      authContext,
      correlationId,
      modelId!,
      version!,
      'SUCCESS',
      event,
      { deploymentId: result.deploymentId }
    );

    return {
      statusCode: 202,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    // Log deployment failure
    if (authContext && modelId && version) {
      await auditMiddleware.logModelDeployment(
        authContext,
        correlationId,
        modelId,
        version,
        'FAILURE',
        event,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    return errorHandler.handleError(error, correlationId);
  }
}

async function getModelStatistics(event: APIGatewayProxyEvent, correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    // Authenticate the request
    const authContext = await authMiddleware.authenticate(event, correlationId);
    
    // Check read permission
    authMiddleware.checkPermission(authContext, 'models:read');

    const queryParams = event.queryStringParameters || {};
    
    // Allow admin users to get statistics for specific teams or all teams
    const requestedTeamId = queryParams.teamId;
    const teamId = authMiddleware.validateTeamAccess(authContext, requestedTeamId);

    const statistics = await modelRegistryService.getModelStatistics(teamId, correlationId);

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