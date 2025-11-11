#!/bin/bash

# Model Registry Deployment Script
# Usage: ./scripts/deploy.sh <environment> [--approve]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENVIRONMENT="${1:-dev}"
APPROVE_FLAG="${2:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate environment
validate_environment() {
    case $ENVIRONMENT in
        dev|staging|prod)
            log_info "Deploying to environment: $ENVIRONMENT"
            ;;
        *)
            log_error "Invalid environment: $ENVIRONMENT"
            log_error "Valid environments: dev, staging, prod"
            exit 1
            ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        exit 1
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK is not installed"
        log_info "Install with: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured"
        log_info "Configure with: aws configure"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Install dependencies
install_dependencies() {
    log_info "Installing dependencies..."
    cd "$PROJECT_ROOT"
    
    if [ ! -d "node_modules" ]; then
        npm ci
    else
        log_info "Dependencies already installed"
    fi
    
    log_success "Dependencies installed"
}

# Run tests
run_tests() {
    log_info "Running tests..."
    cd "$PROJECT_ROOT"
    
    # Run linting
    log_info "Running linter..."
    npm run lint
    
    # Run type checking
    log_info "Running type checking..."
    npm run build
    
    # Run unit tests
    log_info "Running unit tests..."
    npm test
    
    log_success "All tests passed"
}

# Build application
build_application() {
    log_info "Building application..."
    cd "$PROJECT_ROOT"
    
    # Clean previous build
    rm -rf lib/src
    
    # Build TypeScript
    npm run build
    
    # Copy source files to lib directory for CDK
    mkdir -p lib/src
    cp -r dist/* lib/src/
    cp package.json lib/src/
    
    # Install production dependencies in lib/src
    cd lib/src
    npm ci --production --silent
    
    log_success "Application built successfully"
}

# Deploy infrastructure
deploy_infrastructure() {
    log_info "Deploying infrastructure to $ENVIRONMENT..."
    cd "$PROJECT_ROOT"
    
    # Set stack name
    STACK_NAME="ModelRegistryStack-$ENVIRONMENT"
    
    # Prepare CDK context
    CDK_CONTEXT="--context environment=$ENVIRONMENT"
    
    # Set approval flag
    if [ "$APPROVE_FLAG" = "--approve" ]; then
        APPROVAL_FLAG="--require-approval never"
    else
        APPROVAL_FLAG="--require-approval broadening"
    fi
    
    # Bootstrap CDK if needed (only for first deployment)
    if [ "$ENVIRONMENT" = "dev" ]; then
        log_info "Bootstrapping CDK..."
        cdk bootstrap $CDK_CONTEXT
    fi
    
    # Deploy stack
    log_info "Deploying CDK stack: $STACK_NAME"
    cdk deploy $STACK_NAME \
        $CDK_CONTEXT \
        $APPROVAL_FLAG \
        --outputs-file "cdk-outputs-$ENVIRONMENT.json" \
        --progress events
    
    log_success "Infrastructure deployed successfully"
}

# Run post-deployment tests
run_post_deployment_tests() {
    log_info "Running post-deployment tests..."
    cd "$PROJECT_ROOT"
    
    # Extract API Gateway URL from CDK outputs
    if [ -f "cdk-outputs-$ENVIRONMENT.json" ]; then
        API_URL=$(cat "cdk-outputs-$ENVIRONMENT.json" | jq -r ".\"ModelRegistryStack-$ENVIRONMENT\".ModelRegistryApiUrl")
        export API_GATEWAY_URL="$API_URL"
        log_info "API Gateway URL: $API_URL"
    else
        log_warning "CDK outputs file not found, skipping API tests"
        return
    fi
    
    # Run health check
    log_info "Running health check..."
    if curl -f -s "$API_URL/api/v1/health" > /dev/null; then
        log_success "Health check passed"
    else
        log_error "Health check failed"
        exit 1
    fi
    
    # Run integration tests if available
    if npm run test:integration &> /dev/null; then
        log_info "Running integration tests..."
        npm run test:integration
        log_success "Integration tests passed"
    else
        log_info "No integration tests found, skipping"
    fi
}

# Generate deployment report
generate_deployment_report() {
    log_info "Generating deployment report..."
    cd "$PROJECT_ROOT"
    
    REPORT_FILE="deployment-report-$ENVIRONMENT-$(date +%Y%m%d-%H%M%S).json"
    
    # Get AWS account info
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    AWS_REGION=$(aws configure get region)
    
    # Get deployment info
    if [ -f "cdk-outputs-$ENVIRONMENT.json" ]; then
        API_URL=$(cat "cdk-outputs-$ENVIRONMENT.json" | jq -r ".\"ModelRegistryStack-$ENVIRONMENT\".ModelRegistryApiUrl")
        TABLE_NAME=$(cat "cdk-outputs-$ENVIRONMENT.json" | jq -r ".\"ModelRegistryStack-$ENVIRONMENT\".ModelRegistryTableName")
        LAMBDA_ARN=$(cat "cdk-outputs-$ENVIRONMENT.json" | jq -r ".\"ModelRegistryStack-$ENVIRONMENT\".ModelRegistryLambdaArn")
    fi
    
    # Create report
    cat > "$REPORT_FILE" << EOF
{
  "deployment": {
    "environment": "$ENVIRONMENT",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "version": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
    "deployer": "$(whoami)",
    "aws_account": "$AWS_ACCOUNT",
    "aws_region": "$AWS_REGION"
  },
  "resources": {
    "api_gateway_url": "$API_URL",
    "dynamodb_table": "$TABLE_NAME",
    "lambda_function_arn": "$LAMBDA_ARN"
  },
  "status": "success"
}
EOF
    
    log_success "Deployment report generated: $REPORT_FILE"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary files..."
    cd "$PROJECT_ROOT"
    
    # Remove temporary build files
    rm -rf lib/src/node_modules
    
    log_success "Cleanup completed"
}

# Main deployment function
main() {
    log_info "Starting Model Registry deployment..."
    log_info "Environment: $ENVIRONMENT"
    log_info "Timestamp: $(date)"
    
    # Trap cleanup on exit
    trap cleanup EXIT
    
    # Run deployment steps
    validate_environment
    check_prerequisites
    install_dependencies
    run_tests
    build_application
    deploy_infrastructure
    run_post_deployment_tests
    generate_deployment_report
    
    log_success "Deployment completed successfully!"
    log_info "Environment: $ENVIRONMENT"
    
    if [ -f "cdk-outputs-$ENVIRONMENT.json" ]; then
        API_URL=$(cat "cdk-outputs-$ENVIRONMENT.json" | jq -r ".\"ModelRegistryStack-$ENVIRONMENT\".ModelRegistryApiUrl")
        log_info "API Gateway URL: $API_URL"
    fi
}

# Show usage if no arguments provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <environment> [--approve]"
    echo ""
    echo "Environments:"
    echo "  dev      - Development environment"
    echo "  staging  - Staging environment"
    echo "  prod     - Production environment"
    echo ""
    echo "Options:"
    echo "  --approve  - Skip CDK approval prompts"
    echo ""
    echo "Examples:"
    echo "  $0 dev"
    echo "  $0 prod --approve"
    exit 1
fi

# Run main function
main "$@"