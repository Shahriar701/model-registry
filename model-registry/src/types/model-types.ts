export enum ModelFramework {
  SCIKIT_LEARN = 'scikit-learn',
  TENSORFLOW = 'tensorflow',
  PYTORCH = 'pytorch',
  XGBOOST = 'xgboost',
  LIGHTGBM = 'lightgbm',
  HUGGINGFACE = 'huggingface',
  ONNX = 'onnx',
}

export enum DeploymentTarget {
  EKS = 'EKS',
  LAMBDA = 'Lambda',
}

export enum ModelStatus {
  REGISTERED = 'REGISTERED',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  FAILED = 'FAILED',
  DEPRECATED = 'DEPRECATED',
}

export interface ModelMetadata {
  description?: string;
  accuracy?: number;
  features?: string[];
  modelSize?: number;
  trainingDataset?: string;
  hyperparameters?: Record<string, any>;
  tags?: string[];
  [key: string]: any; // Allow additional metadata fields
}

export interface ModelRegistration {
  // DynamoDB keys
  PK: string; // MODEL#{modelId}
  SK: string; // VERSION#{version}
  
  // GSI keys
  GSI1PK: string; // TEAM#{teamId}
  GSI1SK: string; // MODEL#{modelId}#VERSION#{version}
  GSI2PK: string; // DEPLOYMENT#{deploymentTarget}
  GSI2SK: string; // TEAM#{teamId}#MODEL#{modelId}#VERSION#{version}
  
  // Model attributes
  modelId: string;
  modelName: string;
  version: string;
  framework: ModelFramework;
  s3Uri: string;
  deploymentTarget: DeploymentTarget;
  status: ModelStatus;
  teamId: string;
  createdAt: string;
  updatedAt: string;
  metadata: ModelMetadata;
}

export interface RegisterModelRequest {
  modelName: string;
  version: string;
  framework: ModelFramework;
  s3Uri: string;
  deploymentTarget: DeploymentTarget;
  teamId: string;
  metadata?: ModelMetadata;
}

export interface ModelSummary {
  modelId: string;
  modelName: string;
  version: string;
  framework: ModelFramework;
  deploymentTarget: DeploymentTarget;
  status: ModelStatus;
  teamId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListModelsRequest {
  limit?: number;
  nextToken?: string;
  teamId?: string;
  deploymentTarget?: DeploymentTarget;
  namePattern?: string;
  framework?: ModelFramework;
  status?: ModelStatus;
}

export interface ListModelsResponse {
  models: ModelSummary[];
  pagination: {
    nextToken?: string;
    totalCount: number;
  };
}

export interface DeploymentTriggerResponse {
  deploymentId: string;
  message: string;
  status: string;
  modelId: string;
  version: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: Record<string, string>;
}

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  dependencies: Record<string, string>;
}

export interface ModelStatistics {
  totalModels: number;
  totalVersions: number;
  modelsByFramework: Record<string, number>;
  modelsByDeploymentTarget: Record<string, number>;
  modelsByStatus: Record<string, number>;
  modelsByTeam: Record<string, number>;
  timestamp: string;
}