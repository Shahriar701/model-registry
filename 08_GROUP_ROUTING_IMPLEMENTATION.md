# 🔀 08. GROUP-BASED ROUTING IMPLEMENTATION
## Concrete Code Examples for Multi-Tenant Access Control

> **READ AFTER**: 07_KUBERNETES_EKS_INTEGRATION.md
> **PURPOSE**: Detailed implementation of group-based routing with actual code

---

## 🎯 **COMPLETE GROUP-BASED ROUTING IMPLEMENTATION**

### **Architecture Overview:**
```
Request → API Gateway → Lambda Authorizer → Enriched Request → Gateway Handler
                            ↓                      ↓
                    Group Membership         Group-Aware Services
                            ↓                      ↓
                    DynamoDB Groups         Filtered Data Access
```

---

## 🔧 **STEP 1: DATABASE SCHEMA FOR GROUPS**

### **Enhanced DynamoDB Tables:**
```typescript
// Groups Configuration Table
interface GroupConfiguration {
  PK: string; // "GROUP#{groupId}"
  SK: string; // "CONFIG"
  
  // Basic group info
  groupId: string;
  groupName: string;
  description: string;
  groupType: 'team' | 'role' | 'region' | 'tier';
  
  // Access control
  permissions: GroupPermission[];
  dataAccessRules: DataAccessRule[];
  resourceLimits: ResourceLimits;
  
  // Routing preferences
  routingConfig: RoutingConfig;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  
  // GSI for efficient queries
  GSI1PK: string; // "ACTIVE_GROUPS"
  GSI1SK: string; // "TYPE#{groupType}#GROUP#{groupId}"
}

// User Group Membership Table
interface UserGroupMembership {
  PK: string; // "USER#{userId}"
  SK: string; // "GROUP#{groupId}"
  
  userId: string;
  groupId: string;
  role: 'member' | 'admin' | 'owner';
  joinedAt: string;
  expiresAt?: string; // Optional expiration
  
  // Group context for this user
  effectivePermissions: string[];
  dataAccessLevel: 'public' | 'internal' | 'confidential';
  
  // GSI for group-based queries
  GSI1PK: string; // "GROUP#{groupId}"
  GSI1SK: string; // "USER#{userId}"
}

// API Keys with Group Context
interface APIKeyWithGroups {
  PK: string; // "APIKEY#{keyId}"
  SK: string; // "METADATA"
  
  // Basic key info
  apiKeyId: string;
  apiKeyHash: string;
  userId: string;
  tier: 'free' | 'basic' | 'premium' | 'enterprise';
  
  // Group membership (denormalized for performance)
  primaryGroup: string;
  allGroups: string[];
  effectivePermissions: string[];
  maxDataAccessLevel: 'public' | 'internal' | 'confidential';
  
  // Usage and limits
  requestsPerMinute: number;
  requestsPerDay: number;
  monthlyQuota: number;
  
  // Routing preferences
  preferredProviders: string[];
  routingStrategy: 'cost' | 'performance' | 'compliance';
  
  // Metadata
  createdAt: string;
  lastUsedAt: string;
  isActive: boolean;
  
  // GSI keys
  GSI1PK: string; // "USER#{userId}"
  GSI1SK: string; // "CREATED#{timestamp}"
  GSI2PK: string; // "GROUP#{primaryGroup}"
  GSI2SK: string; // "TIER#{tier}#USER#{userId}"
}
```

### **CDK Infrastructure for Group Tables:**
```typescript
// Add to your existing CDK stack
export class EnhancedAiModelGatewayStack extends AiModelGatewayStack {
  constructor(scope: Construct, id: string, props: AiModelGatewayStackProps) {
    super(scope, id, props);
    
    // Groups Configuration Table
    const groupsTable = new dynamodb.Table(this, 'GroupsConfigurationTable', {
      tableName: `${resourcePrefix}-groups`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
    });
    
    // GSI for active groups
    groupsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    
    // User Group Membership Table
    const userGroupsTable = new dynamodb.Table(this, 'UserGroupMembershipTable', {
      tableName: `${resourcePrefix}-user-groups`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
    });
    
    // GSI for group-based queries
    userGroupsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
```

---

## 🔧 **STEP 2: GROUP SERVICE IMPLEMENTATION**

### **Core Group Service:**
```typescript
export class GroupService {
  private dynamoClient: DynamoDBDocumentClient;
  private groupsTableName: string;
  private userGroupsTableName: string;
  private cache: Map<string, any> = new Map();
  
  constructor() {
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    this.groupsTableName = process.env.GROUPS_TABLE_NAME!;
    this.userGroupsTableName = process.env.USER_GROUPS_TABLE_NAME!;
  }
  
  async getUserGroups(userId: string): Promise<UserGroupContext> {
    const cacheKey = `user-groups:${userId}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    try {
      // Query user group memberships
      const command = new QueryCommand({
        TableName: this.userGroupsTableName,
        KeyConditionExpression: 'PK = :userId',
        ExpressionAttributeValues: {
          ':userId': `USER#${userId}`,
        },
      });
      
      const result = await this.dynamoClient.send(command);
      const memberships = result.Items || [];
      
      if (memberships.length === 0) {
        // Default to public group if no memberships found
        const defaultContext: UserGroupContext = {
          userId,
          groups: ['public'],
          primaryGroup: 'public',
          effectivePermissions: ['read:public'],
          dataAccessLevel: 'public',
          routingStrategy: 'cost',
          resourceLimits: this.getDefaultResourceLimits()
        };
        
        this.cache.set(cacheKey, defaultContext);
        return defaultContext;
      }
      
      // Get group configurations for all user groups
      const groupIds = memberships.map(m => m.groupId);
      const groupConfigs = await this.getGroupConfigurations(groupIds);
      
      // Aggregate permissions and access levels
      const userContext = this.aggregateUserContext(userId, memberships, groupConfigs);
      
      // Cache for 5 minutes
      this.cache.set(cacheKey, userContext);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);
      
      return userContext;
      
    } catch (error) {
      console.error('Error getting user groups:', error);
      throw new Error('Failed to retrieve user group information');
    }
  }
  
  private async getGroupConfigurations(groupIds: string[]): Promise<GroupConfiguration[]> {
    const configs: GroupConfiguration[] = [];
    
    // Batch get group configurations
    for (const groupId of groupIds) {
      const cacheKey = `group-config:${groupId}`;
      
      if (this.cache.has(cacheKey)) {
        configs.push(this.cache.get(cacheKey));
        continue;
      }
      
      try {
        const command = new GetCommand({
          TableName: this.groupsTableName,
          Key: {
            PK: `GROUP#${groupId}`,
            SK: 'CONFIG',
          },
        });
        
        const result = await this.dynamoClient.send(command);
        
        if (result.Item) {
          const config = result.Item as GroupConfiguration;
          configs.push(config);
          
          // Cache group config for 10 minutes
          this.cache.set(cacheKey, config);
          setTimeout(() => this.cache.delete(cacheKey), 10 * 60 * 1000);
        }
      } catch (error) {
        console.warn(`Failed to get config for group ${groupId}:`, error);
      }
    }
    
    return configs;
  }
  
  private aggregateUserContext(
    userId: string,
    memberships: any[],
    groupConfigs: GroupConfiguration[]
  ): UserGroupContext {
    
    // Find primary group (highest priority)
    const primaryMembership = memberships.find(m => m.role === 'owner') || 
                             memberships.find(m => m.role === 'admin') ||
                             memberships[0];
    
    // Aggregate all permissions
    const allPermissions = new Set<string>();
    let maxDataAccessLevel: 'public' | 'internal' | 'confidential' = 'public';
    let routingStrategy: 'cost' | 'performance' | 'compliance' = 'cost';
    let resourceLimits = this.getDefaultResourceLimits();
    
    for (const config of groupConfigs) {
      // Add permissions
      config.permissions.forEach(perm => {
        perm.actions.forEach(action => {
          allPermissions.add(`${action}:${perm.resource}`);
        });
      });
      
      // Determine max access level
      if (config.dataAccessRules.some(rule => rule.accessLevel === 'confidential')) {
        maxDataAccessLevel = 'confidential';
      } else if (config.dataAccessRules.some(rule => rule.accessLevel === 'internal') && 
                 maxDataAccessLevel !== 'confidential') {
        maxDataAccessLevel = 'internal';
      }
      
      // Use most restrictive routing strategy
      if (config.routingConfig.strategy === 'compliance') {
        routingStrategy = 'compliance';
      } else if (config.routingConfig.strategy === 'performance' && routingStrategy !== 'compliance') {
        routingStrategy = 'performance';
      }
      
      // Aggregate resource limits (take maximum)
      resourceLimits = this.mergeResourceLimits(resourceLimits, config.resourceLimits);
    }
    
    return {
      userId,
      groups: memberships.map(m => m.groupId),
      primaryGroup: primaryMembership.groupId,
      effectivePermissions: Array.from(allPermissions),
      dataAccessLevel: maxDataAccessLevel,
      routingStrategy,
      resourceLimits,
      groupConfigs: groupConfigs.reduce((acc, config) => {
        acc[config.groupId] = config;
        return acc;
      }, {} as Record<string, GroupConfiguration>)
    };
  }
  
  async hasPermission(
    userContext: UserGroupContext,
    resource: string,
    action: string
  ): Promise<boolean> {
    const requiredPermission = `${action}:${resource}`;
    return userContext.effectivePermissions.includes(requiredPermission) ||
           userContext.effectivePermissions.includes(`${action}:*`) ||
           userContext.effectivePermissions.includes(`*:${resource}`) ||
           userContext.effectivePermissions.includes('*:*');
  }
  
  async canAccessData(
    userContext: UserGroupContext,
    dataAccessLevel: 'public' | 'internal' | 'confidential'
  ): Promise<boolean> {
    const accessLevelHierarchy = {
      'public': 0,
      'internal': 1,
      'confidential': 2
    };
    
    return accessLevelHierarchy[userContext.dataAccessLevel] >= 
           accessLevelHierarchy[dataAccessLevel];
  }
  
  buildDataFilters(userContext: UserGroupContext): DataFilter[] {
    const filters: DataFilter[] = [];
    
    // Add group-based filters from all group configurations
    for (const config of Object.values(userContext.groupConfigs)) {
      filters.push(...config.dataAccessRules.map(rule => ({
        field: rule.field,
        operator: rule.operator,
        values: rule.allowedValues,
        required: rule.required || false
      })));
    }
    
    // Add user-specific filters
    filters.push({
      field: 'accessLevel',
      operator: 'in',
      values: this.getAllowedAccessLevels(userContext.dataAccessLevel),
      required: true
    });
    
    return filters;
  }
  
  private getAllowedAccessLevels(maxLevel: string): string[] {
    switch (maxLevel) {
      case 'confidential':
        return ['public', 'internal', 'confidential'];
      case 'internal':
        return ['public', 'internal'];
      case 'public':
      default:
        return ['public'];
    }
  }
  
  private getDefaultResourceLimits(): ResourceLimits {
    return {
      requestsPerMinute: 10,
      requestsPerDay: 1000,
      maxConcurrentRequests: 5,
      maxTokensPerRequest: 1000,
      allowedProviders: ['openai'],
      allowedModels: ['gpt-3.5-turbo']
    };
  }
  
  private mergeResourceLimits(current: ResourceLimits, additional: ResourceLimits): ResourceLimits {
    return {
      requestsPerMinute: Math.max(current.requestsPerMinute, additional.requestsPerMinute),
      requestsPerDay: Math.max(current.requestsPerDay, additional.requestsPerDay),
      maxConcurrentRequests: Math.max(current.maxConcurrentRequests, additional.maxConcurrentRequests),
      maxTokensPerRequest: Math.max(current.maxTokensPerRequest, additional.maxTokensPerRequest),
      allowedProviders: [...new Set([...current.allowedProviders, ...additional.allowedProviders])],
      allowedModels: [...new Set([...current.allowedModels, ...additional.allowedModels])]
    };
  }
}
```

---

## 🔧 **STEP 3: ENHANCED LAMBDA AUTHORIZER**

### **Group-Aware Authorizer:**
```typescript
export const enhancedAuthorizer = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const apiKey = event.authorizationToken;
  const methodArn = event.methodArn;
  
  try {
    // 1. Validate API Key
    const apiKeyService = new ApiKeyService();
    const keyValidation = await apiKeyService.validateApiKey(apiKey);
    
    if (!keyValidation.valid) {
      throw new Error('Invalid API key');
    }
    
    // 2. Get User Group Context
    const groupService = new GroupService();
    const userContext = await groupService.getUserGroups(keyValidation.userId);
    
    // 3. Generate IAM Policy with Group Context
    const policy = generateGroupAwarePolicy(methodArn, userContext);
    
    // 4. Return Authorization Result with Rich Context
    return {
      principalId: keyValidation.userId,
      policyDocument: policy,
      context: {
        // Basic user info
        userId: keyValidation.userId,
        tier: keyValidation.tier,
        
        // Group information (stringified for Lambda context)
        primaryGroup: userContext.primaryGroup,
        allGroups: JSON.stringify(userContext.groups),
        effectivePermissions: JSON.stringify(userContext.effectivePermissions),
        dataAccessLevel: userContext.dataAccessLevel,
        routingStrategy: userContext.routingStrategy,
        
        // Resource limits
        requestsPerMinute: userContext.resourceLimits.requestsPerMinute.toString(),
        maxTokensPerRequest: userContext.resourceLimits.maxTokensPerRequest.toString(),
        allowedProviders: JSON.stringify(userContext.resourceLimits.allowedProviders),
        allowedModels: JSON.stringify(userContext.resourceLimits.allowedModels),
        
        // Additional context for downstream services
        correlationId: generateCorrelationId(),
        authTimestamp: new Date().toISOString(),
      }
    };
    
  } catch (error) {
    console.error('Authorization failed:', error);
    throw new Error('Unauthorized');
  }
};

function generateGroupAwarePolicy(methodArn: string, userContext: UserGroupContext): PolicyDocument {
  // Extract resource information from method ARN
  const arnParts = methodArn.split(':');
  const apiGatewayArn = arnParts.slice(0, -1).join(':');
  
  // Generate statements based on user permissions
  const statements: Statement[] = [];
  
  // Allow access to endpoints based on permissions
  if (userContext.effectivePermissions.includes('read:completions') || 
      userContext.effectivePermissions.includes('*:*')) {
    statements.push({
      Effect: 'Allow',
      Action: 'execute-api:Invoke',
      Resource: `${apiGatewayArn}:POST/api/v1/completions`
    });
  }
  
  if (userContext.effectivePermissions.includes('read:models') || 
      userContext.effectivePermissions.includes('*:*')) {
    statements.push({
      Effect: 'Allow',
      Action: 'execute-api:Invoke',
      Resource: `${apiGatewayArn}:GET/api/v1/models*`
    });
  }
  
  if (userContext.effectivePermissions.includes('write:models') || 
      userContext.effectivePermissions.includes('*:*')) {
    statements.push({
      Effect: 'Allow',
      Action: 'execute-api:Invoke',
      Resource: `${apiGatewayArn}:POST/api/v1/models*`
    });
  }
  
  // Admin endpoints only for admin groups
  if (userContext.groups.includes('admin') || 
      userContext.effectivePermissions.includes('admin:*')) {
    statements.push({
      Effect: 'Allow',
      Action: 'execute-api:Invoke',
      Resource: `${apiGatewayArn}:*/api/v1/admin/*`
    });
  }
  
  // Default deny if no statements
  if (statements.length === 0) {
    statements.push({
      Effect: 'Deny',
      Action: 'execute-api:Invoke',
      Resource: methodArn
    });
  }
  
  return {
    Version: '2012-10-17',
    Statement: statements
  };
}
```

---

## 🔧 **STEP 4: GROUP-AWARE GATEWAY HANDLER**

### **Enhanced Gateway Handler:**
```typescript
export const enhancedGatewayHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const correlationId = event.headers['X-Correlation-ID'] || generateCorrelationId();
  
  try {
    // 1. Extract User Context from Authorizer
    const userContext = extractUserContextFromEvent(event);
    
    // 2. Route Request Based on Group Context
    const response = await routeRequestWithGroupContext(event, userContext, correlationId);
    
    // 3. Add Group Context to Response Headers
    response.headers = {
      ...response.headers,
      'X-User-Groups': userContext.groups.join(','),
      'X-Data-Access-Level': userContext.dataAccessLevel,
      'X-Correlation-ID': correlationId,
    };
    
    return response;
    
  } catch (error) {
    console.error('Gateway handler error:', error);
    return createErrorResponse(500, 'Internal server error', correlationId);
  }
};

function extractUserContextFromEvent(event: APIGatewayProxyEvent): UserGroupContext {
  const authContext = event.requestContext.authorizer;
  
  return {
    userId: authContext.userId,
    groups: JSON.parse(authContext.allGroups),
    primaryGroup: authContext.primaryGroup,
    effectivePermissions: JSON.parse(authContext.effectivePermissions),
    dataAccessLevel: authContext.dataAccessLevel,
    routingStrategy: authContext.routingStrategy,
    resourceLimits: {
      requestsPerMinute: parseInt(authContext.requestsPerMinute),
      maxTokensPerRequest: parseInt(authContext.maxTokensPerRequest),
      allowedProviders: JSON.parse(authContext.allowedProviders),
      allowedModels: JSON.parse(authContext.allowedModels),
      requestsPerDay: 10000, // Default, could be passed from context
      maxConcurrentRequests: 10 // Default, could be passed from context
    }
  };
}

async function routeRequestWithGroupContext(
  event: APIGatewayProxyEvent,
  userContext: UserGroupContext,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  
  const { path, httpMethod } = event;
  
  // Route based on path and group permissions
  if (path === '/api/v1/completions' && httpMethod === 'POST') {
    return await handleGroupAwareCompletions(event, userContext, correlationId);
  }
  
  if (path.startsWith('/api/v1/models') && httpMethod === 'GET') {
    return await handleGroupAwareModelListing(event, userContext, correlationId);
  }
  
  if (path.startsWith('/api/v1/models') && httpMethod === 'POST') {
    return await handleGroupAwareModelRegistration(event, userContext, correlationId);
  }
  
  if (path.startsWith('/api/v1/admin/') && userContext.effectivePermissions.includes('admin:*')) {
    return await handleAdminEndpoints(event, userContext, correlationId);
  }
  
  // Default 404 for unmatched routes
  return createErrorResponse(404, 'Route not found', correlationId);
}

async function handleGroupAwareCompletions(
  event: APIGatewayProxyEvent,
  userContext: UserGroupContext,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  
  try {
    // 1. Parse and validate request
    const requestBody = JSON.parse(event.body || '{}');
    const llmRequest = validateLLMRequest(requestBody);
    
    // 2. Check model access permissions
    if (!userContext.resourceLimits.allowedModels.includes(llmRequest.model)) {
      return createErrorResponse(403, `Access denied to model: ${llmRequest.model}`, correlationId);
    }
    
    // 3. Apply group-based context enhancement
    const groupAwareMCPService = new GroupAwareMCPService();
    const enhancedRequest = await groupAwareMCPService.injectMCPContext(llmRequest, userContext);
    
    // 4. Route to appropriate provider based on group preferences
    const groupAwareRouter = new GroupAwareProviderRouter();
    const selectedProvider = await groupAwareRouter.selectProvider(enhancedRequest, userContext);
    
    // 5. Process request with group context
    const response = await selectedProvider.generateCompletion(enhancedRequest);
    
    // 6. Add group-specific metadata to response
    response.metadata = {
      ...response.metadata,
      userGroups: userContext.groups,
      dataAccessLevel: userContext.dataAccessLevel,
      routingStrategy: userContext.routingStrategy,
      correlationId
    };
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('Group-aware completions error:', error);
    return createErrorResponse(500, 'Failed to process completion request', correlationId);
  }
}
```

---

## 🎯 **INTERVIEW TALKING POINTS**

### **When Asked About Group-Based Routing:**
```
"I implement group-based routing through a multi-layer approach:

1. Database Layer: Groups are stored in DynamoDB with permissions and data access rules
2. Authentication Layer: Lambda authorizer enriches requests with group context
3. Application Layer: Services filter data and route requests based on group membership
4. Caching Layer: Cache keys include group context to prevent data leakage

For example, marketing team gets access to all product data for recommendations, 
while customer service only sees support-relevant information, and external 
partners see only public data."
```

### **When Asked About Implementation Details:**
```
"The implementation uses DynamoDB for group configuration storage, with GSIs 
for efficient querying. The Lambda authorizer aggregates user permissions from 
multiple groups and passes this context to downstream services. Each service 
then applies group-specific filtering at the data access layer.

I also implement resource limits per group - enterprise users get higher rate 
limits and access to premium models, while free tier users are restricted to 
basic models and lower quotas."
```

---

## 🚀 **WHAT'S NEXT?**

You now have concrete implementation details for group-based routing. Next, we'll create the practical debugging scenarios you can actually test in your project.

**Key Takeaway**: Group-based routing is implemented through database design, authentication enrichment, and service-level filtering. Your system can handle complex multi-tenant scenarios with proper data isolation.

🎯 **You now have the complete implementation details for enterprise-grade multi-tenancy!**