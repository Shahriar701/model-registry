// Test setup file
import { jest } from '@jest/globals';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Set default environment variables for tests
process.env.MODELS_TABLE_NAME = 'test-models-table';
process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
process.env.AUDIT_LOG_GROUP_NAME = '/aws/lambda/test-audit';
process.env.METRICS_NAMESPACE = 'TestModelRegistry';