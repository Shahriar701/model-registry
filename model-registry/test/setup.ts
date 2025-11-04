// Jest setup file for Model Registry tests

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'DEBUG';
process.env.MODELS_TABLE_NAME = 'test-models-table';
process.env.METRICS_NAMESPACE = 'ModelRegistry';

// Mock AWS SDK clients for tests
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-cloudwatch');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-eventbridge');