# Model Registry

A serverless ML Model Registry for centralized model metadata management, built with AWS CDK and TypeScript.

## Overview

The Model Registry is a foundational component of a self-service ML platform that enables data science teams to register and manage their trained ML models before deployment to either EKS (Kubernetes) or Lambda (serverless) environments.

## Features

- **Model Registration**: Register ML models with metadata validation
- **Version Management**: Track multiple versions of the same model
- **Model Discovery**: Query and list registered models with pagination
- **Deployment Integration**: Trigger deployment pipelines for registered models
- **Team-based Access**: Multi-tenant support with team-based access controls
- **Observability**: Comprehensive logging and monitoring with CloudWatch
- **Security**: KMS encryption, IAM least-privilege access, input validation

## Architecture

- **API Gateway**: REST API with request validation and throttling
- **Lambda**: Serverless compute for model operations
- **DynamoDB**: NoSQL database for model metadata storage
- **EventBridge**: Event-driven deployment pipeline integration
- **CloudWatch**: Logging, metrics, and monitoring

## API Endpoints

```
POST   /api/v1/models                    # Register new model
GET    /api/v1/models                    # List all models (paginated)
GET    /api/v1/models/{modelId}          # Get all versions of a model
GET    /api/v1/models/{modelId}/{version} # Get specific model version
PUT    /api/v1/models/{modelId}/{version} # Update model metadata
DELETE /api/v1/models/{modelId}/{version} # Deregister model version
POST   /api/v1/models/{modelId}/{version}/deploy # Trigger deployment
GET    /api/v1/health                    # Health check
```

## Getting Started

### Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK CLI installed

### Installation

```bash
npm install
```

### Development

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Format code
npm run format
```

### Deployment

```bash
# Bootstrap CDK (first time only)
npm run bootstrap

# Deploy to development environment
npm run deploy:dev

# Deploy to production environment
npm run deploy:prod

# View differences before deployment
npm run diff

# Destroy stack
npm run destroy
```

## Configuration

Environment variables:
- `ENVIRONMENT`: Deployment environment (dev, staging, prod)
- `CDK_DEFAULT_ACCOUNT`: AWS account ID
- `CDK_DEFAULT_REGION`: AWS region

## Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- model-registry.test.ts
```

## Project Structure

```
model-registry/
├── bin/                    # CDK app entry point
├── lib/                    # CDK stack definitions
├── src/                    # Lambda function source code
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── validation/        # Input validation logic
├── test/                  # Test files
└── dist/                  # Compiled JavaScript (generated)
```

## Contributing

1. Follow TypeScript and ESLint conventions
2. Write tests for new functionality
3. Update documentation as needed
4. Use conventional commit messages

## License

MIT