#!/bin/bash

# Integration Test Script for Model Registry
# Usage: ./scripts/test-integration.sh [environment]

set -e

ENVIRONMENT="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get API Gateway URL from CDK outputs
get_api_url() {
    local outputs_file="$PROJECT_ROOT/cdk-outputs-$ENVIRONMENT.json"
    
    if [ ! -f "$outputs_file" ]; then
        log_error "CDK outputs file not found: $outputs_file"
        log_error "Please deploy the stack first: ./scripts/deploy.sh $ENVIRONMENT"
        exit 1
    fi
    
    API_URL=$(cat "$outputs_file" | jq -r ".\"ModelRegistryStack-$ENVIRONMENT\".ModelRegistryApiUrl")
    
    if [ "$API_URL" = "null" ] || [ -z "$API_URL" ]; then
        log_error "Could not extract API Gateway URL from CDK outputs"
        exit 1
    fi
    
    log_info "API Gateway URL: $API_URL"
}

# Test health endpoint
test_health_endpoint() {
    log_info "Testing health endpoint..."
    
    local response=$(curl -s -w "%{http_code}" "$API_URL/api/v1/health")
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        log_success "Health check passed"
        echo "Response: $body" | jq '.'
    else
        log_error "Health check failed with status: $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Test model registration
test_model_registration() {
    log_info "Testing model registration..."
    
    local test_model='{
        "modelName": "test-integration-model",
        "version": "1.0.0",
        "framework": "scikit-learn",
        "s3Uri": "s3://test-bucket/test-model/v1.0.0/model.pkl",
        "deploymentTarget": "EKS",
        "metadata": {
            "description": "Integration test model",
            "accuracy": 0.95
        }
    }'
    
    local response=$(curl -s -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer test-token" \
        -d "$test_model" \
        "$API_URL/api/v1/models")
    
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "201" ]; then
        log_success "Model registration test passed"
        echo "Response: $body" | jq '.'
        
        # Extract model ID for cleanup
        MODEL_ID=$(echo "$body" | jq -r '.modelId')
        export MODEL_ID
    else
        log_error "Model registration test failed with status: $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Test model listing
test_model_listing() {
    log_info "Testing model listing..."
    
    local response=$(curl -s -w "%{http_code}" \
        -H "Authorization: Bearer test-token" \
        "$API_URL/api/v1/models")
    
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        log_success "Model listing test passed"
        echo "Response: $body" | jq '.'
    else
        log_error "Model listing test failed with status: $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Test model retrieval
test_model_retrieval() {
    if [ -z "$MODEL_ID" ]; then
        log_info "Skipping model retrieval test (no model ID available)"
        return 0
    fi
    
    log_info "Testing model retrieval..."
    
    local response=$(curl -s -w "%{http_code}" \
        -H "Authorization: Bearer test-token" \
        "$API_URL/api/v1/models/$MODEL_ID/1.0.0")
    
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        log_success "Model retrieval test passed"
        echo "Response: $body" | jq '.'
    else
        log_error "Model retrieval test failed with status: $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Test error handling
test_error_handling() {
    log_info "Testing error handling..."
    
    # Test invalid model registration
    local invalid_model='{
        "modelName": "",
        "version": "invalid-version",
        "framework": "invalid-framework"
    }'
    
    local response=$(curl -s -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer test-token" \
        -d "$invalid_model" \
        "$API_URL/api/v1/models")
    
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "400" ]; then
        log_success "Error handling test passed"
        echo "Response: $body" | jq '.'
    else
        log_error "Error handling test failed with status: $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Cleanup test data
cleanup_test_data() {
    if [ -z "$MODEL_ID" ]; then
        log_info "No test data to cleanup"
        return 0
    fi
    
    log_info "Cleaning up test data..."
    
    local response=$(curl -s -w "%{http_code}" \
        -X DELETE \
        -H "Authorization: Bearer test-token" \
        "$API_URL/api/v1/models/$MODEL_ID/1.0.0")
    
    local http_code="${response: -3}"
    
    if [ "$http_code" = "204" ]; then
        log_success "Test data cleanup completed"
    else
        log_error "Test data cleanup failed with status: $http_code"
    fi
}

# Run performance tests
test_performance() {
    log_info "Running basic performance tests..."
    
    # Test concurrent requests
    log_info "Testing concurrent health checks..."
    
    for i in {1..10}; do
        curl -s "$API_URL/api/v1/health" > /dev/null &
    done
    
    wait
    log_success "Concurrent requests test completed"
    
    # Test response time
    log_info "Testing response time..."
    local start_time=$(date +%s%N)
    curl -s "$API_URL/api/v1/health" > /dev/null
    local end_time=$(date +%s%N)
    local duration=$(( (end_time - start_time) / 1000000 ))
    
    log_info "Health endpoint response time: ${duration}ms"
    
    if [ $duration -lt 5000 ]; then
        log_success "Response time test passed"
    else
        log_error "Response time test failed (${duration}ms > 5000ms)"
        return 1
    fi
}

# Main test function
main() {
    log_info "Starting integration tests for environment: $ENVIRONMENT"
    
    cd "$PROJECT_ROOT"
    
    # Get API URL
    get_api_url
    
    # Run tests
    local failed_tests=0
    
    test_health_endpoint || ((failed_tests++))
    test_model_registration || ((failed_tests++))
    test_model_listing || ((failed_tests++))
    test_model_retrieval || ((failed_tests++))
    test_error_handling || ((failed_tests++))
    test_performance || ((failed_tests++))
    
    # Cleanup
    cleanup_test_data
    
    # Report results
    if [ $failed_tests -eq 0 ]; then
        log_success "All integration tests passed!"
        exit 0
    else
        log_error "$failed_tests test(s) failed"
        exit 1
    fi
}

# Check dependencies
if ! command -v curl &> /dev/null; then
    log_error "curl is required but not installed"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    log_error "jq is required but not installed"
    exit 1
fi

# Run main function
main "$@"