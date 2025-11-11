#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ModelRegistryStack } from '../lib/model-registry-stack';
import * as fs from 'fs';
import * as path from 'path';

const app = new cdk.App();

// Get environment from context
const environment = app.node.tryGetContext('environment') || 'dev';

// Load environment-specific configuration
const configPath = path.join(__dirname, '..', 'config', 'environments', `${environment}.json`);

if (!fs.existsSync(configPath)) {
  throw new Error(`Configuration file not found for environment: ${environment}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Validate required configuration
if (!config.aws?.region || !config.aws?.account) {
  throw new Error(`AWS region and account must be specified in ${configPath}`);
}

// Create stack with environment-specific configuration
const stackName = `ModelRegistryStack-${environment}`;

new ModelRegistryStack(app, stackName, {
  environment,
  env: {
    account: config.aws.account,
    region: config.aws.region,
  },
  description: `Model Registry infrastructure for ${environment} environment`,
  tags: {
    Environment: environment,
    Project: 'ModelRegistry',
    ManagedBy: 'CDK',
    CostCenter: 'MLOps',
  },
});

// Add stack-level tags
cdk.Tags.of(app).add('Project', 'ModelRegistry');
cdk.Tags.of(app).add('Environment', environment);
cdk.Tags.of(app).add('ManagedBy', 'CDK');