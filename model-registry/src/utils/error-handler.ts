import { APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from './logger';

export enum ErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  DUPLICATE_RESOURCE = 'DUPLICATE_RESOURCE',
  UNAUTHORIZED = 'UNAUTHORIZED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}

export interface ErrorResponse {
  error: {
    type: ErrorType;
    message: string;
    details?: Record<string, string>;
    correlationId: string;
    timestamp: string;
  };
}

export class ModelRegistryError extends Error {
  constructor(
    public readonly type: ErrorType,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, string>
  ) {
    super(message);
    this.name = 'ModelRegistryError';
  }
}

export class ErrorHandler {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger();
  }

  handleError(error: any, correlationId: string): APIGatewayProxyResult {
    if (error instanceof ModelRegistryError) {
      return this.createErrorResponse(
        error.type,
        error.message,
        error.statusCode,
        correlationId,
        error.details
      );
    }

    // Handle AWS SDK errors
    if (error.name === 'ConditionalCheckFailedException') {
      return this.createErrorResponse(
        ErrorType.DUPLICATE_RESOURCE,
        'Resource already exists',
        409,
        correlationId
      );
    }

    if (error.name === 'ResourceNotFoundException') {
      return this.createErrorResponse(
        ErrorType.RESOURCE_NOT_FOUND,
        'Resource not found',
        404,
        correlationId
      );
    }

    if (error.name === 'ValidationException') {
      return this.createErrorResponse(
        ErrorType.VALIDATION_ERROR,
        'Invalid request data',
        400,
        correlationId
      );
    }

    if (error.name === 'AccessDeniedException' || error.name === 'UnauthorizedOperation') {
      return this.createErrorResponse(
        ErrorType.UNAUTHORIZED,
        'Access denied',
        403,
        correlationId
      );
    }

    // Handle network and service errors
    if (error.name === 'NetworkingError' || error.name === 'TimeoutError') {
      return this.createErrorResponse(
        ErrorType.EXTERNAL_SERVICE_ERROR,
        'External service unavailable',
        503,
        correlationId
      );
    }

    // Log unexpected errors
    this.logger.error('Unexpected error in model registry', {
      correlationId,
      error: error.message,
      stack: error.stack,
      name: error.name,
    });

    // Return generic internal server error
    return this.createErrorResponse(
      ErrorType.INTERNAL_ERROR,
      'An internal error occurred',
      500,
      correlationId
    );
  }

  createErrorResponse(
    type: ErrorType,
    message: string,
    statusCode: number,
    correlationId: string,
    details?: Record<string, string>
  ): APIGatewayProxyResult {
    const errorResponse: ErrorResponse = {
      error: {
        type,
        message,
        details,
        correlationId,
        timestamp: new Date().toISOString(),
      },
    };

    // Log error details
    this.logger.error('Model registry error', {
      correlationId,
      type,
      message,
      statusCode,
      details,
    });

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(errorResponse),
    };
  }
}