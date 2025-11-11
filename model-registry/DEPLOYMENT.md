# Model Registry Deployment Guide

This document provides comprehensive instructions for deploying the Model Registry service to different environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Deployment Methods](#deployment-methods)
- [CI/CD Pipeline](#cicd-pipeline)
- [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)
- [Rollback Procedures](#rollback-procedures)

## Prerequisites

### Required Tools

1. **Node.js** (v18 or later)
   ```bash
   node --version
   ```

2. **AWS CLI** (v2 recommended)
   ```bash
   aws --version
   aws configure
   ```

3. **AWS CDK** (v2)
   ```bash
   npm install -g aws-cdk
   cdk --version
   ```

4. **jq** (for JSON processing)
   ```bash
   # macOS
   brew install jq
   
   # Ubuntu/Debian
   sudo apt-get install jq
   ```

### AWS Permissions

The deployment requires the following AWS permissions:

- **CloudFormation**: Full access for stack management
- **Lambda**: Create, update, and manage functions
- **API Gateway**: Create and manage REST APIs
- **DynamoDB**: Create and manage tables
- **IAM**: Create and manage roles and policies
- **KMS**: Create and manage encryption keys
- **CloudWatch**: Create log groups and metrics
- **S3**: Access to model artifact buckets

### AWS Account Setup

1. **Bootstrap CDK** (one-time per account/region):
   ```bash
   cdk bootstrap aws://ACCOUNT-NUMBER/REGION
   ```

2. **Configure AWS credentials**:
   ```bash
   aws configure
   # or use AWS SSO, IAM roles, etc.
   ```

## Environment Configuration

The Model Registry supports three environments:

### Development (dev)
- **Purpose**: Local development and testing
- **Configuration**: `config/environments/dev.json`
- **Features**: Debug logging, relaxed security, development features enabled

### Staging (staging)
- **Purpose**: Pre-production testing and validation
- **Configuration**: `config/environments/staging.json`
- **Features**: Production-like setup with enhanced monitoring

### Production (prod)
- **Purpose**: Live production environment
- **Configuration**: `config/environments/prod.json`
- **Features**: High availability, security hardening, comprehensive monitoring

### Configuration Files

Each environment has its own configuration file in `config/environments/`:

```json
{
  "environment": "dev",
  "aws": {
    "region": "us-east-1",
    "account": "123456789012"
  },
  "modelRegistry": {
    "logLevel": "DEBUG",
    "corsOrigins": ["*"],
    "rateLimiting": {
      "enabled": true,
      "requestsPerMinute": 1000
    }
  },
  // ... additional configuration
}
```

## Deployment Methods

### Method 1: Automated Script (Recommended)

The deployment script handles the entire deployment process:

```bash
# Deploy to development
./scripts/deploy.sh dev

# Deploy to staging with auto-approval
./scripts/deploy.sh staging --approve

# Deploy to production
./scripts/deploy.sh prod
```

The script performs:
1. Prerequisites validation
2. Dependency installation
3. Code compilation and testing
4. Infrastructure deployment
5. Post-deployment validation
6. Report generation

### Method 2: Manual CDK Deployment

For more control over the deployment process:

```bash
# Install dependencies
npm ci

# Build the application
npm run build

# Deploy infrastructure
cdk deploy ModelRegistryStack-dev \
  --context environment=dev \
  --require-approval never
```

### Method 3: NPM Scripts

Use the predefined npm scripts:

```bash
# Deploy to different environments
npm run deploy:dev
npm run deploy:staging
npm run deploy:prod
```

## CI/CD Pipeline

### GitHub Actions Workflow

The repository includes a comprehensive GitHub Actions workflow (`.github/workflows/ci-cd.yml`) that:

1. **Runs on**:
   - Push to `main` or `develop` branches
   - Pull requests
   - Manual workflow dispatch

2. **Pipeline Stages**:
   - **Test**: Linting, type checking, unit tests, security scanning
   - **Build**: Application compilation and packaging
   - **Deploy**: Environment-specific deployments
   - **Validate**: Post-deployment testing

3. **Environment Flow**:
   ```
   develop branch → dev environment
   main branch → staging environment
   manual trigger → production environment
   ```

### Required Secrets

Configure the following secrets in your GitHub repository:

```bash
# Development/Staging
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY

# Production (separate credentials recommended)
AWS_ACCESS_KEY_ID_PROD
AWS_SECRET_ACCESS_KEY_PROD

# GitHub token for releases
GITHUB_TOKEN
```

### Environment Protection Rules

Configure environment protection rules in GitHub:

- **Development**: No restrictions
- **Staging**: Require review from team leads
- **Production**: Require review from multiple approvers, deployment windows

## Deployment Validation

### Automated Tests

After deployment, run validation tests:

```bash
# Integration tests
./scripts/test-integration.sh dev

# Health check
curl -f https://api-url/api/v1/health

# Smoke tests
npm run test:smoke
```

### Manual Validation

1. **API Gateway**: Verify endpoints are accessible
2. **DynamoDB**: Check table creation and indexes
3. **Lambda**: Verify function deployment and configuration
4. **CloudWatch**: Check logs and metrics
5. **Monitoring**: Verify dashboards and alerts

## Monitoring and Troubleshooting

### CloudWatch Dashboards

The deployment creates dashboards for:
- API Gateway metrics (requests, latency, errors)
- Lambda function metrics (invocations, duration, errors)
- DynamoDB metrics (read/write capacity, throttling)

### Log Analysis

```bash
# View Lambda logs
aws logs tail /aws/lambda/model-registry-dev-handler --follow

# View API Gateway logs
aws logs tail API-Gateway-Execution-Logs_<api-id>/dev --follow
```

### Common Issues

1. **Deployment Failures**:
   - Check AWS credentials and permissions
   - Verify CDK bootstrap status
   - Review CloudFormation events

2. **API Errors**:
   - Check Lambda function logs
   - Verify DynamoDB table permissions
   - Review API Gateway configuration

3. **Performance Issues**:
   - Monitor Lambda cold starts
   - Check DynamoDB throttling
   - Review API Gateway caching

### Troubleshooting Commands

```bash
# Check CDK diff
cdk diff ModelRegistryStack-dev --context environment=dev

# View CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name ModelRegistryStack-dev

# Check Lambda function status
aws lambda get-function \
  --function-name model-registry-dev-handler
```

## Rollback Procedures

### Automatic Rollback

The CI/CD pipeline includes automatic rollback on deployment failures.

### Manual Rollback

1. **Lambda Function**:
   ```bash
   # List function versions
   aws lambda list-versions-by-function \
     --function-name model-registry-prod-handler
   
   # Update alias to previous version
   aws lambda update-alias \
     --function-name model-registry-prod-handler \
     --name LIVE \
     --function-version <previous-version>
   ```

2. **Full Stack Rollback**:
   ```bash
   # Deploy previous version
   git checkout <previous-commit>
   ./scripts/deploy.sh prod --approve
   ```

3. **Database Rollback**:
   ```bash
   # Point-in-time recovery (if needed)
   aws dynamodb restore-table-to-point-in-time \
     --source-table-name model-registry-prod-models \
     --target-table-name model-registry-prod-models-restored \
     --restore-date-time <timestamp>
   ```

## Security Considerations

### Production Deployment

1. **API Keys**: Enable API key authentication
2. **CORS**: Restrict origins to known domains
3. **WAF**: Enable Web Application Firewall
4. **Encryption**: Use customer-managed KMS keys
5. **VPC**: Deploy Lambda in private subnets (if required)

### Secrets Management

- Use AWS Secrets Manager for sensitive configuration
- Rotate API keys regularly
- Implement least-privilege IAM policies

## Cost Optimization

### Development Environment

- Use PAY_PER_REQUEST billing for DynamoDB
- Lower Lambda memory allocation
- Disable unnecessary features

### Production Environment

- Use provisioned capacity for predictable workloads
- Enable DynamoDB auto-scaling
- Implement API Gateway caching
- Set up CloudWatch cost alerts

## Maintenance

### Regular Tasks

1. **Update Dependencies**:
   ```bash
   npm audit
   npm update
   ```

2. **Clean Up Old Versions**:
   ```bash
   # Remove old Lambda versions
   aws lambda list-versions-by-function \
     --function-name model-registry-prod-handler \
     --query 'Versions[?Version!=`$LATEST`]|[:-5]' \
     --output text | \
   xargs -I {} aws lambda delete-function \
     --function-name model-registry-prod-handler \
     --qualifier {}
   ```

3. **Monitor Costs**:
   - Review AWS Cost Explorer
   - Set up billing alerts
   - Optimize resource usage

### Backup and Recovery

1. **DynamoDB**: Point-in-time recovery enabled
2. **Code**: Version control with Git
3. **Configuration**: Infrastructure as Code with CDK
4. **Monitoring**: CloudWatch logs retention

## Support and Documentation

- **API Documentation**: Available at `/api/v1/docs` (if enabled)
- **Monitoring**: CloudWatch dashboards and alarms
- **Logs**: Centralized logging in CloudWatch
- **Metrics**: Custom metrics in CloudWatch

For additional support, refer to:
- AWS CDK Documentation
- AWS Lambda Best Practices
- DynamoDB Developer Guide
- API Gateway Documentation