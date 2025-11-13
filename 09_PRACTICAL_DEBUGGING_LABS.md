# 🧪 09. PRACTICAL DEBUGGING LABS
## Hands-On Debugging Practice with Your Actual Project

> **READ AFTER**: 08_GROUP_ROUTING_IMPLEMENTATION.md
> **PURPOSE**: Create real debugging scenarios you can practice with your deployed project

---

## 🎯 **HANDS-ON DEBUGGING PRACTICE PLAN**

### **How This Works:**
1. **Create Git Branches** with intentional bugs
2. **Deploy Each Branch** to test environment
3. **Follow Debugging Methodology** to find and fix issues
4. **Practice Interview Explanations** while debugging

### **Lab Structure:**
- **Lab 1**: Authentication/Group Access Issues
- **Lab 2**: Provider Routing and Circuit Breaker Problems  
- **Lab 3**: Database Performance and Hot Partition Issues
- **Lab 4**: Caching and Data Consistency Problems
- **Lab 5**: MCP Integration and Context Injection Failures

---

## 🧪 **LAB 1: AUTHENTICATION & GROUP ACCESS DEBUGGING**

### **Scenario Setup:**
Create a branch with authentication issues that cause group-based access failures.

#### **Step 1: Create Bug Branch**
```bash
# Create debugging branch
git checkout -b debug-lab-auth-issues
```

#### **Step 2: Introduce Authentication Bugs**
```typescript
// File: src/lambda/authorizer/index.ts
// BUG 1: Incorrect group membership check
export const handler = async (event: APIGatewayTokenAuthorizerEvent) => {
  const apiKey = event.authorizationToken;
  
  try {
    const validation = await apiKeyService.validateApiKey(apiKey);
    
    if (!validation.valid) {
      throw new Error('Invalid API key');
    }
    
    // BUG: Using wrong user ID for group lookup
    const userGroups = await groupService.getUserGroups(validation.keyId); // Should be validation.userId
    
    return {
      principalId: validation.userId,
      policyDocument: generatePolicy('Allow', event.methodArn),
      context: {
        userId: validation.userId,
        groups: JSON.stringify(userGroups.groups),
        // BUG: Missing data access level in context
        // dataAccessLevel: userGroups.dataAccessLevel,
      }
    };
  } catch (error) {
    throw new Error('Unauthorized');
  }
};

// File: src/services/auth/api-key-service.ts  
// BUG 2: Cache key collision
class ApiKeyService {
  private cache = new Map<string, any>();
  
  async validateApiKey(apiKey: string): Promise<ValidationResult> {
    // BUG: Cache key doesn't include full API key, causing collisions
    const cacheKey = apiKey.substring(0, 8); // Should use full hash
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // ... rest of validation logic
  }
}

// File: src/services/group/group-service.ts
// BUG 3: Permission aggregation logic error
private aggregateUserContext(userId: string, memberships: any[], groupConfigs: GroupConfiguration[]): UserGroupContext {
  const allPermissions = new Set<string>();
  
  for (const config of groupConfigs) {
    config.permissions.forEach(perm => {
      // BUG: Using OR instead of AND for permission combination
      if (perm.resource === 'models' || perm.actions.includes('read')) { // Should be AND
        allPermissions.add(`read:models`);
      }
    });
  }
  
  return {
    userId,
    groups: memberships.map(m => m.groupId),
    effectivePermissions: Array.from(allPermissions),
    // ... rest of context
  };
}
```

#### **Step 3: Deploy Bug Branch**
```bash
# Deploy the buggy version
npm run build
npx cdk deploy ai-gateway-dev
```

#### **Step 4: Debugging Practice Session**

**Symptoms You'll Observe:**
- Marketing team users getting 403 errors on product recommendations
- Some API keys working intermittently
- Users with multiple groups getting incorrect permissions

**Your Debugging Process (Practice This Out Loud):**

```typescript
// Step 1: Clarify the Problem
"Let me understand this issue:
- When did the authentication problems start?
- Is this affecting all users or specific groups?
- Are there patterns in the API keys that work vs don't work?
- What was the last deployment or change made?"

// Step 2: Gather Information
"I need to check several data sources:
1. API Gateway logs for 403 error patterns
2. Lambda authorizer logs for authentication failures  
3. DynamoDB API key table for data consistency
4. CloudWatch metrics for authentication success rates"

// Step 3: Form Hypothesis
"Based on the symptoms, I have three hypotheses:
1. Group membership lookup is failing for certain users
2. API key validation has caching issues causing intermittent failures
3. Permission aggregation logic is incorrect for multi-group users"

// Step 4: Systematic Investigation
"Let me test each hypothesis:

Hypothesis 1 - Group Membership:
- Check authorizer logs for group lookup errors
- Verify DynamoDB queries are using correct user IDs
- Test with known good user/group combinations

Hypothesis 2 - Caching Issues:
- Look for cache key patterns in logs
- Test same API key multiple times
- Check for cache key collisions

Hypothesis 3 - Permission Logic:
- Review permission aggregation code
- Test users with single vs multiple groups
- Verify permission inheritance rules"
```

**Investigation Commands You'll Run:**
```bash
# Check authorizer logs
aws logs filter-log-events \
  --log-group-name "/aws/lambda/ai-gateway-dev-api-authorizer" \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern "ERROR"

# Check API Gateway access logs
aws logs filter-log-events \
  --log-group-name "API-Gateway-Execution-Logs_<api-id>/v1" \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern "403"

# Query DynamoDB for user group data
aws dynamodb query \
  --table-name ai-gateway-dev-user-groups \
  --key-condition-expression "PK = :userId" \
  --expression-attribute-values '{":userId":{"S":"USER#test-user-123"}}'
```

**Root Cause Discovery Process:**
```typescript
// What you'll find:
"After systematic investigation, I found three bugs:

1. Authorizer using keyId instead of userId for group lookup
2. API key cache using truncated keys causing collisions  
3. Permission aggregation using OR logic instead of AND

The combination of these bugs caused inconsistent authentication 
behavior, especially for users with multiple group memberships."
```

**Fix Implementation:**
```typescript
// Fix the bugs you introduced
// Then redeploy and verify the fix works
npm run build
npx cdk deploy ai-gateway-dev

// Test the fixes
curl -X POST https://your-api-gateway-url/api/v1/completions \
  -H "X-API-Key: your-test-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test"}]}'
```

---

## 🧪 **LAB 2: PROVIDER ROUTING & CIRCUIT BREAKER DEBUGGING**

### **Scenario Setup:**
Create cascading failures in provider routing with circuit breaker issues.

#### **Step 1: Create Bug Branch**
```bash
git checkout main
git checkout -b debug-lab-provider-routing
```

#### **Step 2: Introduce Provider Routing Bugs**
```typescript
// File: src/services/router/provider-router.ts
// BUG 1: Circuit breaker threshold too low
class ProviderRouter {
  private circuitBreakers = new Map<string, CircuitBreaker>();
  
  constructor() {
    // BUG: Threshold too low, causing premature circuit opening
    this.circuitBreakers.set('openai', new CircuitBreaker({
      failureThreshold: 2, // Should be 5
      timeout: 10000,      // Should be 60000
      halfOpenMaxCalls: 1  // Should be 3
    }));
  }
  
  async selectProvider(request: LLMRequest): Promise<ProviderAdapter> {
    // BUG 2: Not checking circuit breaker state before selection
    const providers = this.getAvailableProviders();
    
    // Should check circuit breaker state here
    return providers[0]; // Just returning first provider
  }
}

// File: src/services/providers/openai-provider.ts
// BUG 3: No retry logic for transient failures
class OpenAIProvider implements ProviderAdapter {
  async generateCompletion(request: LLMRequest): Promise<LLMResponse> {
    try {
      // BUG: No retry logic for rate limits or transient errors
      const response = await this.openaiClient.createCompletion(request);
      return this.transformResponse(response);
    } catch (error) {
      // BUG: All errors treated the same, no differentiation
      throw new ProviderError('OpenAI request failed');
    }
  }
}

// File: src/services/providers/bedrock-provider.ts  
// BUG 4: Connection not properly pooled
class BedrockProvider implements ProviderAdapter {
  async generateCompletion(request: LLMRequest): Promise<LLMResponse> {
    // BUG: Creating new client for each request
    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    
    try {
      const response = await client.send(new InvokeModelCommand({
        modelId: request.model,
        body: JSON.stringify(request)
      }));
      
      return this.transformResponse(response);
    } catch (error) {
      // BUG: Not handling cold start errors specifically
      throw new ProviderError('Bedrock request failed');
    }
  }
}
```

#### **Step 3: Deploy and Test**
```bash
npm run build
npx cdk deploy ai-gateway-dev

# Generate load to trigger circuit breaker issues
for i in {1..10}; do
  curl -X POST https://your-api-gateway-url/api/v1/completions \
    -H "X-API-Key: your-test-key" \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test '$i'"}]}' &
done
```

#### **Step 4: Debugging Practice**

**Symptoms You'll Observe:**
- Requests failing with "Circuit breaker open" errors
- High latency followed by complete failures
- Provider switching not working correctly

**Your Debugging Approach:**
```typescript
// Practice this systematic approach:
"I'm seeing cascade failures in the provider routing system. 
Let me investigate systematically:

1. Check circuit breaker states and thresholds
2. Analyze provider response times and error rates  
3. Review retry logic and error handling
4. Examine connection pooling and resource usage"
```

---

## 🧪 **LAB 3: DATABASE PERFORMANCE DEBUGGING**

### **Scenario Setup:**
Create hot partition and performance issues in DynamoDB.

#### **Step 1: Create Performance Issues**
```typescript
// File: src/services/model-registry-service.ts
// BUG 1: Poor partition key design causing hot partitions
async registerModel(request: RegisterModelRequest): Promise<ModelRegistration> {
  const modelRecord = {
    // BUG: Using timestamp as partition key causes hot partitions
    PK: `TIMESTAMP#${new Date().toISOString().split('T')[0]}`, // Should be MODEL#{modelId}
    SK: `MODEL#${request.modelName}#${request.version}`,
    // ... rest of record
  };
  
  await this.dynamoClient.send(new PutCommand({
    TableName: this.tableName,
    Item: modelRecord
  }));
}

// BUG 2: Inefficient query patterns
async listModels(request: ListModelsRequest): Promise<ListModelsResponse> {
  // BUG: Using scan instead of query
  const command = new ScanCommand({
    TableName: this.tableName,
    FilterExpression: 'contains(modelName, :name)',
    ExpressionAttributeValues: {
      ':name': request.namePattern || ''
    }
  });
  
  const result = await this.dynamoClient.send(command);
  return this.transformResults(result.Items || []);
}
```

#### **Step 2: Generate Load to Trigger Issues**
```bash
# Script to create hot partition scenario
for i in {1..100}; do
  curl -X POST https://your-api-gateway-url/api/v1/models \
    -H "X-API-Key: your-admin-key" \
    -H "Content-Type: application/json" \
    -d '{
      "modelName": "test-model-'$i'",
      "version": "1.0.0",
      "framework": "tensorflow",
      "s3Uri": "s3://test-bucket/model-'$i'",
      "deploymentTarget": "Lambda"
    }' &
done
```

#### **Step 3: Debug Performance Issues**
```bash
# Check DynamoDB metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=ai-gateway-dev-models \
  --start-time $(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Check for throttling
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name UserErrors \
  --dimensions Name=TableName,Value=ai-gateway-dev-models \
  --start-time $(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

---

## 🧪 **LAB 4: CACHING CONSISTENCY DEBUGGING**

### **Scenario Setup:**
Create cache invalidation and consistency issues.

#### **Step 1: Introduce Caching Bugs**
```typescript
// File: src/services/cache/cache-manager.ts
// BUG 1: Cache keys don't include group context
class CacheManager {
  generateCacheKey(baseKey: string, userContext?: UserContext): string {
    // BUG: Not including group context in cache key
    return baseKey; // Should include group hash
  }
  
  async invalidateByGroup(groupId: string): Promise<void> {
    // BUG: Not properly invalidating group-specific cache entries
    const pattern = `*${groupId}*`; // Too broad, will match unrelated keys
    const keys = await this.redisClient.keys(pattern);
    
    // BUG: Not handling Redis errors
    await this.redisClient.del(...keys);
  }
}
```

#### **Step 2: Test Cache Issues**
```bash
# Test cache consistency across groups
# User 1 (marketing group)
curl -X GET "https://your-api-gateway-url/api/v1/models" \
  -H "X-API-Key: marketing-user-key"

# User 2 (customer-service group) - should see different data
curl -X GET "https://your-api-gateway-url/api/v1/models" \
  -H "X-API-Key: customer-service-key"

# Update group permissions and test cache invalidation
# Should see immediate effect, but won't due to cache bug
```

---

## 🧪 **LAB 5: MCP INTEGRATION DEBUGGING**

### **Scenario Setup:**
Create context injection and product data filtering issues.

#### **Step 1: Introduce MCP Bugs**
```typescript
// File: src/services/mcp/mcp-context-service.ts
// BUG 1: Not applying group filters to product search
class MCPContextService {
  async injectMCPContext(request: LLMRequest, userContext: UserContext): Promise<LLMRequest> {
    const intent = await this.extractIntent(request.messages);
    
    if (intent.type === 'product_search') {
      // BUG: Not passing user context to product search
      const products = await this.productService.searchProducts(intent.query);
      
      // BUG: Not filtering products by group access rules
      const context = this.formatProductsForLLM(products);
      return this.injectContext(request, context);
    }
    
    return request;
  }
}
```

---

## 🎯 **DEBUGGING PRACTICE SCHEDULE**

### **Week 1: Setup and Lab 1**
- Day 1: Set up debugging environment and branches
- Day 2-3: Practice Lab 1 (Authentication issues)
- Day 4-5: Master the systematic debugging approach

### **Week 2: Labs 2-3**  
- Day 1-2: Practice Lab 2 (Provider routing)
- Day 3-4: Practice Lab 3 (Database performance)
- Day 5: Review and consolidate learnings

### **Week 3: Labs 4-5 and Integration**
- Day 1-2: Practice Lab 4 (Caching issues)
- Day 3-4: Practice Lab 5 (MCP integration)
- Day 5: End-to-end debugging scenarios

---

## 🎯 **INTERVIEW SIMULATION EXERCISES**

### **Exercise 1: Live Debugging Session**
1. Deploy a bug branch without looking at the code
2. Set 45-minute timer
3. Debug the issue while explaining your process out loud
4. Document your findings and solution

### **Exercise 2: Root Cause Analysis**
1. Given symptoms, form multiple hypotheses
2. Design investigation plan
3. Execute investigation systematically
4. Present findings and prevention measures

### **Exercise 3: Production Incident Response**
1. Simulate high-pressure debugging scenario
2. Practice immediate mitigation vs long-term fixes
3. Focus on communication and systematic approach
4. Document lessons learned

---

## 🚀 **SUCCESS METRICS**

### **You're Ready When You Can:**
- [ ] Debug any issue in under 30 minutes
- [ ] Explain your thinking process clearly while debugging
- [ ] Form multiple hypotheses and test them systematically
- [ ] Propose both immediate fixes and long-term prevention
- [ ] Reference your actual project experience confidently

### **Key Debugging Phrases to Master:**
- "Let me approach this systematically..."
- "Based on the symptoms, my hypothesis is..."
- "To verify this, I would check..."
- "For immediate mitigation, I'd..."
- "In my experience with this system..."

---

**🎯 These hands-on labs give you real debugging experience with your actual project. Practice them multiple times to build confidence and systematic thinking skills!**