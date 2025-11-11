# 📮 POSTMAN SETUP GUIDE
## Quick Start for Testing Model Registry API

---

## 🚀 **QUICK SETUP (5 Minutes)**

### **Step 1: Import Collections**

1. **Open Postman**
2. **Click "Import"** (top left)
3. **Drag and drop these files:**
   - `Model-Registry.postman_collection.json`
   - `Model-Registry.postman_environment.json`

### **Step 2: Configure Environment**

1. **Select Environment**: Click dropdown (top right) → Select "Model Registry - Development"
2. **Edit Environment Variables**:
   - Click the eye icon (👁️) next to environment dropdown
   - Click "Edit"
   - Update these values:

```json
{
  "BASE_URL": "https://your-actual-api-gateway-url.execute-api.us-east-1.amazonaws.com/v1",
  "API_KEY": "your-actual-api-key",
  "TEAM_ID": "data-science-team"
}
```

### **Step 3: Get Your API Gateway URL**

```bash
# Get Model Registry API URL
aws cloudformation describe-stacks \
  --stack-name model-registry-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ModelRegistryApiUrl`].OutputValue' \
  --output text

# Or from CDK output after deployment
# Look for: ModelRegistryStack.ModelRegistryApiUrl = https://...
```

### **Step 4: Create Test API Key**

```bash
# Create a test API key in DynamoDB
aws dynamodb put-item \
  --table-name model-registry-dev-api-keys \
  --item '{
    "apiKeyId": {"S": "test-key-123"},
    "apiKeyHash": {"S": "sk-test-model-registry-key"},
    "userId": {"S": "test-user"},
    "tier": {"S": "enterprise"},
    "groups": {"L": [{"S": "data-science-team"}]},
    "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"},
    "isActive": {"BOOL": true}
  }'

# Use this API key in Postman: sk-test-model-registry-key
```

---

## 🧪 **TESTING WORKFLOW**

### **Recommended Test Order:**

#### **1. Health Checks** ✅
```
Folder: Health Checks
→ Basic Health Check
→ Detailed Health Check

Purpose: Verify system is running
Expected: 200 OK with health status
```

#### **2. Model Registration** ✅
```
Folder: Model Registration
→ Register TensorFlow Model
→ Register PyTorch Model for EKS
→ Register Scikit-Learn Model

Purpose: Create test models
Expected: 201 Created with modelId
Note: MODEL_ID is automatically saved to environment
```

#### **3. Model Discovery** ✅
```
Folder: Model Discovery
→ List All Models
→ Get All Versions of a Model (uses saved MODEL_ID)
→ Get Specific Model Version

Purpose: Verify models are registered
Expected: 200 OK with model data
```

#### **4. Model Management** ✅
```
Folder: Model Management
→ Update Model Metadata
→ Delete Model Version (optional)

Purpose: Test CRUD operations
Expected: 200 OK for update, 204 for delete
```

#### **5. Model Deployment** ✅
```
Folder: Model Deployment
→ Trigger Model Deployment

Purpose: Test deployment pipeline
Expected: 202 Accepted with deploymentId
Note: DEPLOYMENT_ID is automatically saved
```

#### **6. Analytics** ✅
```
Folder: Analytics & Statistics
→ Get Model Statistics
→ Get Team Statistics

Purpose: View platform metrics
Expected: 200 OK with statistics
```

#### **7. Error Scenarios** ✅
```
Folder: Error Scenarios
→ Invalid S3 URI (Should Fail)
→ Missing Required Fields (Should Fail)
→ Register Duplicate Model (Should Fail)
→ Get Non-Existent Model (Should Fail)

Purpose: Test error handling
Expected: 400/404/409 errors with proper messages
```

---

## 🎯 **AUTOMATED TESTING**

### **Run All Tests at Once:**

1. **Right-click on "Model Registry API" collection**
2. **Select "Run collection"**
3. **Click "Run Model Registry API"**
4. **Watch tests execute automatically**

### **Expected Results:**
- ✅ All health checks pass
- ✅ Model registration succeeds
- ✅ Model discovery returns data
- ✅ Error scenarios return proper error codes
- ✅ Overall success rate: 90%+ (some errors are expected)

---

## 🔧 **TROUBLESHOOTING**

### **Problem: 401 Unauthorized**
```
Solution:
1. Check API_KEY in environment is correct
2. Verify API key exists in DynamoDB
3. Check API key is active (isActive: true)
```

### **Problem: 404 Not Found**
```
Solution:
1. Verify BASE_URL is correct
2. Check API Gateway is deployed
3. Ensure stage name is correct (/v1)
```

### **Problem: 500 Internal Server Error**
```
Solution:
1. Check Lambda function logs:
   aws logs tail /aws/lambda/model-registry-dev-handler --follow
2. Verify DynamoDB table exists
3. Check IAM permissions
```

### **Problem: MODEL_ID not auto-populated**
```
Solution:
1. Check "Tests" tab in request
2. Verify test script is present:
   pm.environment.set("MODEL_ID", jsonData.modelId);
3. Manually copy modelId from response and set in environment
```

---

## 📊 **VIEWING RESULTS**

### **Check DynamoDB Data:**
```bash
# List all registered models
aws dynamodb scan \
  --table-name model-registry-dev-models \
  --filter-expression "begins_with(PK, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"MODEL#"}}' \
  --max-items 10

# Get specific model
aws dynamodb get-item \
  --table-name model-registry-dev-models \
  --key '{
    "PK": {"S": "MODEL#fraud-detection-model"},
    "SK": {"S": "VERSION#1.0.0"}
  }'
```

### **Check CloudWatch Logs:**
```bash
# View recent logs
aws logs tail /aws/lambda/model-registry-dev-handler \
  --since 10m \
  --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/model-registry-dev-handler \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s)000
```

### **Check CloudWatch Metrics:**
```bash
# Model registration count
aws cloudwatch get-metric-statistics \
  --namespace ModelRegistry \
  --metric-name ModelRegistrations \
  --start-time $(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

---

## 🎯 **INTEGRATION WITH AI GATEWAY**

### **Testing Both Systems Together:**

1. **Complete Model Registry tests** (this collection)
2. **Switch to AI Gateway collection**
3. **Run LLM completion requests**
4. **Verify AI Gateway discovers registered models**

See `SYSTEM_INTEGRATION_GUIDE.md` for detailed integration testing.

---

## 📝 **SAMPLE TEST DATA**

### **Valid Model Registration:**
```json
{
  "modelName": "test-model",
  "version": "1.0.0",
  "framework": "tensorflow",
  "s3Uri": "s3://test-bucket/models/test-model/v1.0.0/model.tar.gz",
  "deploymentTarget": "Lambda",
  "teamId": "data-science-team",
  "metadata": {
    "description": "Test model for validation",
    "accuracy": 0.95,
    "tags": ["test", "validation"]
  }
}
```

### **Valid Frameworks:**
- `tensorflow`
- `pytorch`
- `scikit-learn`
- `xgboost`
- `lightgbm`
- `huggingface`
- `onnx`

### **Valid Deployment Targets:**
- `Lambda`
- `EKS`

---

## 🚀 **NEXT STEPS**

After completing Model Registry testing:

1. ✅ **Test AI Gateway** - Use AI Gateway Postman collection
2. ✅ **Test Integration** - Follow SYSTEM_INTEGRATION_GUIDE.md
3. ✅ **Practice Debugging** - Use debugging labs from study materials
4. ✅ **Review for Interview** - Use these tests to demonstrate your system

---

**🎉 You're now ready to test and demonstrate your complete ML platform!**