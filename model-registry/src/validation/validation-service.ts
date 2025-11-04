import { z } from 'zod';
import { ModelFramework, DeploymentTarget, ModelStatus } from '../types/model-types';
import { ValidationResult } from '../types/model-types';

export class ValidationService {
  private readonly registerModelSchema = z.object({
    modelName: z.string()
      .min(1, 'Model name is required')
      .max(100, 'Model name must be less than 100 characters')
      .regex(/^[a-zA-Z0-9-_]+$/, 'Model name can only contain alphanumeric characters, hyphens, and underscores'),
    
    version: z.string()
      .min(1, 'Version is required')
      .regex(/^\d+\.\d+\.\d+$/, 'Version must follow semantic versioning format (e.g., 1.0.0)'),
    
    framework: z.nativeEnum(ModelFramework, {
      errorMap: () => ({ message: `Framework must be one of: ${Object.values(ModelFramework).join(', ')}` })
    }),
    
    s3Uri: z.string()
      .min(1, 'S3 URI is required')
      .regex(/^s3:\/\/[a-z0-9.-]+\/.*$/, 'S3 URI must be in format s3://bucket/key'),
    
    deploymentTarget: z.nativeEnum(DeploymentTarget, {
      errorMap: () => ({ message: `Deployment target must be one of: ${Object.values(DeploymentTarget).join(', ')}` })
    }),
    
    metadata: z.object({
      description: z.string().max(1000).optional(),
      accuracy: z.number().min(0).max(1).optional(),
      features: z.array(z.string()).max(100).optional(),
      modelSize: z.number().positive().optional(),
      trainingDataset: z.string().max(500).optional(),
      hyperparameters: z.record(z.any()).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
    }).optional(),
  });

  private readonly updateModelMetadataSchema = z.object({
    description: z.string().max(1000).optional(),
    accuracy: z.number().min(0).max(1).optional(),
    features: z.array(z.string()).max(100).optional(),
    modelSize: z.number().positive().optional(),
    trainingDataset: z.string().max(500).optional(),
    hyperparameters: z.record(z.any()).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  });

  validateRegisterModelRequest(data: any): ValidationResult {
    try {
      this.registerModelSchema.parse(data);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors: Record<string, string> = {};
        error.errors.forEach(err => {
          const path = err.path.join('.');
          errors[path] = err.message;
        });
        return { isValid: false, errors };
      }
      return { isValid: false, errors: { general: 'Validation failed' } };
    }
  }

  validateUpdateModelMetadata(data: any): ValidationResult {
    try {
      this.updateModelMetadataSchema.parse(data);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors: Record<string, string> = {};
        error.errors.forEach(err => {
          const path = err.path.join('.');
          errors[path] = err.message;
        });
        return { isValid: false, errors };
      }
      return { isValid: false, errors: { general: 'Validation failed' } };
    }
  }

  validateModelId(modelId: string): ValidationResult {
    if (!modelId || typeof modelId !== 'string') {
      return { isValid: false, errors: { modelId: 'Model ID is required' } };
    }

    if (modelId.length > 100) {
      return { isValid: false, errors: { modelId: 'Model ID must be less than 100 characters' } };
    }

    if (!/^[a-z0-9-]+$/.test(modelId)) {
      return { isValid: false, errors: { modelId: 'Model ID can only contain lowercase letters, numbers, and hyphens' } };
    }

    return { isValid: true };
  }

  validateVersion(version: string): ValidationResult {
    if (!version || typeof version !== 'string') {
      return { isValid: false, errors: { version: 'Version is required' } };
    }

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return { isValid: false, errors: { version: 'Version must follow semantic versioning format (e.g., 1.0.0)' } };
    }

    return { isValid: true };
  }

  validateTeamId(teamId: string): ValidationResult {
    if (!teamId || typeof teamId !== 'string') {
      return { isValid: false, errors: { teamId: 'Team ID is required' } };
    }

    if (teamId.length > 50) {
      return { isValid: false, errors: { teamId: 'Team ID must be less than 50 characters' } };
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(teamId)) {
      return { isValid: false, errors: { teamId: 'Team ID can only contain alphanumeric characters, hyphens, and underscores' } };
    }

    return { isValid: true };
  }

  validatePaginationParams(limit?: string, nextToken?: string): ValidationResult {
    const errors: Record<string, string> = {};

    if (limit !== undefined) {
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        errors.limit = 'Limit must be a number between 1 and 100';
      }
    }

    if (nextToken !== undefined) {
      try {
        // Validate that nextToken is a valid base64 encoded JSON
        const decoded = Buffer.from(nextToken, 'base64').toString();
        JSON.parse(decoded);
      } catch (error) {
        errors.nextToken = 'Invalid next token format';
      }
    }

    return Object.keys(errors).length === 0 
      ? { isValid: true }
      : { isValid: false, errors };
  }

  validateDeploymentTarget(deploymentTarget?: string): ValidationResult {
    if (deploymentTarget && !Object.values(DeploymentTarget).includes(deploymentTarget as DeploymentTarget)) {
      return { 
        isValid: false, 
        errors: { 
          deploymentTarget: `Deployment target must be one of: ${Object.values(DeploymentTarget).join(', ')}` 
        } 
      };
    }

    return { isValid: true };
  }

  validateFramework(framework?: string): ValidationResult {
    if (framework && !Object.values(ModelFramework).includes(framework as ModelFramework)) {
      return { 
        isValid: false, 
        errors: { 
          framework: `Framework must be one of: ${Object.values(ModelFramework).join(', ')}` 
        } 
      };
    }

    return { isValid: true };
  }

  validateModelStatus(status?: string): ValidationResult {
    if (status && !Object.values(ModelStatus).includes(status as ModelStatus)) {
      return { 
        isValid: false, 
        errors: { 
          status: `Status must be one of: ${Object.values(ModelStatus).join(', ')}` 
        } 
      };
    }

    return { isValid: true };
  }

  validateNamePattern(namePattern?: string): ValidationResult {
    if (namePattern && namePattern.length > 100) {
      return { 
        isValid: false, 
        errors: { 
          namePattern: 'Name pattern must be less than 100 characters' 
        } 
      };
    }

    return { isValid: true };
  }
}