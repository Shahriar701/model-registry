# 🏗️ 02. SYSTEM DESIGN DEEP DIVE
## Complete Technical Implementation Guide

> **READ AFTER**: 01_THINKING_FRAMEWORK_START_HERE.md
> **PURPOSE**: Deep technical knowledge for your AI platform design

---

## 🎯 **YOUR PROJECT AS THE PERFECT INTERVIEW ANSWER**

**The Golden Question They'll Ask:**
> *"Design a production-ready AI platform that enables e-commerce teams to integrate LLMs with product data, ensuring security, scalability, and cost efficiency for millions of users."*

**This is EXACTLY your project!** Here's the complete technical deep dive:

---

## 🏗️ **DETAILED ARCHITECTURE COMPONENTS**

### **1. API Gateway & Security Layer**

#### **Multi-Tier Authentication System**
```typescript
// API Key Tiers with Group-Based Access
interface APIKeyTier {
  tier: 'free' | 'basic' | 'premium' | 'enterprise';
  requestsPerMinute: number;
  requestsPerDay: number;
  allowedModels: string[];
  groupPermissions: GroupPermission[];
  dataAccessLevel: 'public' | 'internal' | 'confidential';
}

const tierConfigurations: Record<string, APIKeyTier> = {
  free: {
    tier: 'free',
    requestsPerMinute: 10,
    requestsPerDay: 1000,
    allowedModels: ['gpt-3.5-turbo'],
    groupPermissions: ['public_read'],
    dataAccessLevel: 'public'
  },
  enterprise: {
    tier: 'enterprise',
    requestsPerMinute: 10000,
    requestsPerDay: 1000000,
    allowedModels: ['gpt-4', 'claude-3', 'gpt-3.5-turbo'],
    groupPermissions: ['admin', 'read', 'write', 'deploy'],
    dataAccessLevel: 'confidential'
  }
};
```

#### **Group-Based Access Control Implementation**
```typescript
// Group Permission System
interface GroupPermission {
  groupId: string;
  groupName: string;
  permissions: Permission[];
  dataFilters: DataFilter[];
  providerAccess: ProviderAccess[];
}

interface Permission {
  resource: string; // 'models', 'products', 'analytics'
  actions: string[]; // ['read', 'write', 'delete', 'deploy']
  conditions?: Record<string, any>;
}

interface DataFilter {
  field: string; // 'region', 'category', 'team'
  operator: 'equals' | 'in' | 'not_in';
  values: string[];
}

// Example Group Configurations
const groupConfigurations: GroupPermission[] = [
  {
    groupId: 'marketing-team',
    groupName: 'Marketing Team',
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'recommendations', actions: ['read', 'write'] }
    ],
    dataFilters: [
      { field: 'category', operator: 'in', values: ['electronics', 'fashion'] },
      { field: 'region', operator: 'equals', values: ['EU'] }
    ],
    providerAccess: [
      { provider: 'openai', models: ['gpt-3.5-turbo'], priority: 1 },
      { provider: 'bedrock', models: ['claude-3-haiku'], priority: 2 }
    ]
  },
  {
    groupId: 'customer-service',
    groupName: 'Customer Service',
    permissions: [
      { resource: 'products', actions: ['read'] },
      { resource: 'customers', actions: ['read'] },
      { resource: 'support-tickets', actions: ['read', 'write'] }
    ],
    dataFilters: [
      { field: 'customer-region', operator: 'equals', values: ['current-user-region'] }
    ],
    providerAccess: [
      { provider: 'openai', models: ['gpt-4'], priority: 1 }
    ]
  }
];
```

### **2. Enhanced Authentication Flow**
```typescript
// Lambda Authorizer with Group-Based Logic
export const authorizer = async (event: APIGatewayTokenAuthorizerEvent) => {
  const apiKey = event.authorizationToken;
  
  try {
    // 1. Validate API Key
    const keyValidation = await validateApiKey(apiKey);
    if (!keyValidation.valid) {
      throw new Error('Invalid API key');
    }
    
    // 2. Get User Groups and Permissions
    const userGroups = await getUserGroups(keyValidation.userId);
    const permissions = await aggregatePermissions(userGroups);
    
    // 3. Generate IAM Policy with Group Context
    const policy = generateIAMPolicy('Allow', event.methodArn, {
      userId: keyValidation.userId,
      tier: keyValidation.tier,
      groups: userGroups.map(g => g.groupId),
      permissions: permissions,
      dataFilters: aggregateDataFilters(userGroups)
    });
    
    return {
      principalId: keyValidation.userId,
      policyDocument: policy,
      context: {
        userId: keyValidation.userId,
        tier: keyValidation.tier,
        groups: JSON.stringify(userGroups),
        permissions: JSON.stringify(permissions)
      }
    };
  } catch (error) {
    throw new Error('Unauthorized');
  }
};
```

### **3. AI Gateway with Group-Aware Routing**

#### **Provider Selection with Group Preferences**
```typescript
class GroupAwareProviderRouter {
  async selectProvider(
    request: LLMRequest, 
    userContext: UserContext
  ): Promise<ProviderAdapter> {
    
    // 1. Get group-specific provider preferences
    const groupPreferences = await this.getGroupProviderPreferences(userContext.groups);
    
    // 2. Filter providers based on group access
    const allowedProviders = this.filterProvidersByGroupAccess(
      this.availableProviders,
      groupPreferences
    );
    
    // 3. Check model access permissions
    const modelAllowedProviders = allowedProviders.filter(provider => 
      this.canAccessModel(provider, request.model, userContext)
    );
    
    // 4. Apply group-specific routing logic
    const routingStrategy = this.getGroupRoutingStrategy(userContext.groups);
    
    switch (routingStrategy) {
      case 'cost-optimized':
        return this.selectCheapestProvider(modelAllowedProviders, request);
      case 'performance-optimized':
        return this.selectFastestProvider(modelAllowedProviders, request);
      case 'compliance-first':
        return this.selectCompliantProvider(modelAllowedProviders, userContext);
      default:
        return this.selectBalancedProvider(modelAllowedProviders, request);
    }
  }
  
  private async handleBedrockColdStart(
    provider: BedrockProvider,
    request: LLMRequest,
    userContext: UserContext
  ): Promise<LLMResponse> {
    
    // Check if Bedrock is warm for this model
    const isWarm = await this.isBedrockModelWarm(request.model);
    
    if (!isWarm) {
      // Strategy 1: Route to OpenAI if urgent request
      if (request.priority === 'high' || userContext.tier === 'enterprise') {
        const fallbackProvider = await this.getFallbackProvider('openai', request.model);
        if (fallbackProvider) {
          return await fallbackProvider.generateCompletion(request);
        }
      }
      
      // Strategy 2: Async processing for non-urgent requests
      if (request.priority === 'low') {
        await this.queueForAsyncProcessing(request, userContext);
        return this.createAsyncResponse(request);
      }
      
      // Strategy 3: Warm up Bedrock and wait (with timeout)
      await this.warmUpBedrockModel(request.model);
      
      // Wait with timeout
      const warmUpPromise = this.waitForWarmUp(request.model, 5000); // 5s timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Warm-up timeout')), 5000)
      );
      
      try {
        await Promise.race([warmUpPromise, timeoutPromise]);
      } catch (error) {
        // Fallback to OpenAI if warm-up fails
        const fallbackProvider = await this.getFallbackProvider('openai', request.model);
        return await fallbackProvider.generateCompletion(request);
      }
    }
    
    // Proceed with Bedrock request
    return await provider.generateCompletion(request);
  }
}
```

#### **Bedrock Cold Start Mitigation Strategies**
```typescript
// Bedrock Warm-Up Service
class BedrockWarmUpService {
  private warmUpCache = new Map<string, { lastWarmUp: number; isWarm: boolean }>();
  
  constructor() {
    // Schedule regular warm-up calls
    this.scheduleWarmUpCalls();
  }
  
  private scheduleWarmUpCalls() {
    // Warm up popular models every 5 minutes
    setInterval(async () => {
      const popularModels = await this.getPopularModels();
      await Promise.all(
        popularModels.map(model => this.warmUpModel(model))
      );
    }, 5 * 60 * 1000); // 5 minutes
    
    // Predictive warm-up based on usage patterns
    setInterval(async () => {
      const predictedModels = await this.predictUpcomingUsage();
      await Promise.all(
        predictedModels.map(model => this.warmUpModel(model))
      );
    }, 2 * 60 * 1000); // 2 minutes
  }
  
  async warmUpModel(modelId: string): Promise<void> {
    try {
      const warmUpRequest = {
        modelId,
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1,
          messages: [{ role: "user", content: "." }]
        })
      };
      
      const startTime = Date.now();
      await this.bedrockClient.send(new InvokeModelCommand(warmUpRequest));
      const latency = Date.now() - startTime;
      
      // Update warm status
      this.warmUpCache.set(modelId, {
        lastWarmUp: Date.now(),
        isWarm: true
      });
      
      // Record metrics
      await this.metricsService.recordWarmUp(modelId, latency, true);
      
    } catch (error) {
      this.warmUpCache.set(modelId, {
        lastWarmUp: Date.now(),
        isWarm: false
      });
      
      await this.metricsService.recordWarmUp(modelId, 0, false);
    }
  }
  
  isModelWarm(modelId: string): boolean {
    const warmStatus = this.warmUpCache.get(modelId);
    if (!warmStatus) return false;
    
    // Consider warm if warmed up in last 10 minutes
    const warmThreshold = 10 * 60 * 1000; // 10 minutes
    return warmStatus.isWarm && 
           (Date.now() - warmStatus.lastWarmUp) < warmThreshold;
  }
  
  private async predictUpcomingUsage(): Promise<string[]> {
    // Analyze usage patterns to predict which models will be needed
    const currentHour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    // Get historical usage patterns
    const usagePatterns = await this.getUsagePatterns(currentHour, dayOfWeek);
    
    // Predict models likely to be used in next 15 minutes
    return usagePatterns
      .filter(pattern => pattern.probability > 0.7)
      .map(pattern => pattern.modelId);
  }
}

// Connection Pool for Bedrock
class BedrockConnectionPool {
  private connections = new Map<string, BedrockRuntimeClient>();
  private connectionHealth = new Map<string, { lastUsed: number; healthy: boolean }>();
  
  getConnection(region: string = 'us-east-1'): BedrockRuntimeClient {
    let connection = this.connections.get(region);
    
    if (!connection || !this.isConnectionHealthy(region)) {
      connection = new BedrockRuntimeClient({
        region,
        maxAttempts: 3,
        requestTimeout: 30000,
        // Keep connections alive
        requestHandler: {
          keepAlive: true,
          keepAliveMsecs: 30000,
          maxSockets: 50
        }
      });
      
      this.connections.set(region, connection);
      this.connectionHealth.set(region, {
        lastUsed: Date.now(),
        healthy: true
      });
    }
    
    // Update last used time
    const health = this.connectionHealth.get(region)!;
    health.lastUsed = Date.now();
    
    return connection;
  }
  
  private isConnectionHealthy(region: string): boolean {
    const health = this.connectionHealth.get(region);
    if (!health) return false;
    
    // Consider connection stale after 5 minutes of inactivity
    const staleThreshold = 5 * 60 * 1000;
    return health.healthy && (Date.now() - health.lastUsed) < staleThreshold;
  }
}
```

### **4. Group-Aware MCP Integration**

#### **Context Injection Based on Group Permissions**
```typescript
class GroupAwareMCPService {
  async injectMCPContext(
    request: LLMRequest, 
    userContext: UserContext
  ): Promise<LLMRequest> {
    
    // 1. Determine what data this group can access
    const dataAccessRules = this.getGroupDataAccess(userContext.groups);
    
    // 2. Extract intent from request
    const intent = await this.extractIntent(request.messages);
    
    // 3. Execute appropriate MCP tools with group filtering
    const mcpResults = await this.executeMCPTools(intent, dataAccessRules);
    
    // 4. Format context based on group preferences
    const formattedContext = this.formatContextForGroup(mcpResults, userContext.groups);
    
    // 5. Inject into request
    return this.injectContext(request, formattedContext);
  }
  
  private async executeMCPTools(
    intent: Intent, 
    dataAccessRules: DataAccessRule[]
  ): Promise<MCPResult[]> {
    
    const results: MCPResult[] = [];
    
    if (intent.type === 'product_search') {
      // Apply group-specific filters
      const searchFilters = this.buildSearchFilters(intent.parameters, dataAccessRules);
      
      const products = await this.productSearchTool.execute({
        query: intent.parameters.query,
        filters: searchFilters,
        limit: intent.parameters.limit || 10
      });
      
      results.push({
        tool: 'product_search',
        data: products,
        metadata: { filtered: true, groupRestricted: true }
      });
    }
    
    if (intent.type === 'recommendation' && this.canAccessRecommendations(dataAccessRules)) {
      const recommendations = await this.recommendationTool.execute({
        userId: intent.parameters.userId,
        category: intent.parameters.category,
        filters: this.buildRecommendationFilters(dataAccessRules)
      });
      
      results.push({
        tool: 'recommendations',
        data: recommendations,
        metadata: { personalized: true }
      });
    }
    
    return results;
  }
  
  private buildSearchFilters(
    intentParams: any, 
    dataAccessRules: DataAccessRule[]
  ): SearchFilter[] {
    
    const filters: SearchFilter[] = [];
    
    // Apply group-based data restrictions
    for (const rule of dataAccessRules) {
      switch (rule.field) {
        case 'region':
          filters.push({
            field: 'region',
            operator: 'in',
            values: rule.allowedValues
          });
          break;
          
        case 'category':
          filters.push({
            field: 'category',
            operator: 'in',
            values: rule.allowedValues
          });
          break;
          
        case 'price_range':
          if (rule.maxValue) {
            filters.push({
              field: 'price',
              operator: 'lte',
              values: [rule.maxValue]
            });
          }
          break;
      }
    }
    
    // Add intent-specific filters
    if (intentParams.category) {
      filters.push({
        field: 'category',
        operator: 'equals',
        values: [intentParams.category]
      });
    }
    
    if (intentParams.priceRange) {
      filters.push({
        field: 'price',
        operator: 'between',
        values: [intentParams.priceRange.min, intentParams.priceRange.max]
      });
    }
    
    return filters;
  }
}
```

---

## 📊 **DATABASE DESIGN FOR GROUP-BASED ACCESS**

### **Enhanced DynamoDB Schema**
```typescript
// API Keys Table with Group Information
interface APIKeyRecord {
  PK: string; // "APIKEY#{keyId}"
  SK: string; // "METADATA"
  
  // Basic key info
  apiKeyId: string;
  apiKeyHash: string;
  userId: string;
  tier: string;
  
  // Group membership
  groups: string[]; // ["marketing-team", "eu-region"]
  permissions: Permission[];
  
  // Usage tracking
  createdAt: string;
  lastUsedAt: string;
  requestCount: number;
  
  // GSI keys
  GSI1PK: string; // "USER#{userId}"
  GSI1SK: string; // "CREATED#{timestamp}"
  GSI2PK: string; // "GROUP#{groupId}"
  GSI2SK: string; // "USER#{userId}"
}

// Group Configuration Table
interface GroupRecord {
  PK: string; // "GROUP#{groupId}"
  SK: string; // "CONFIG"
  
  groupId: string;
  groupName: string;
  description: string;
  
  // Access control
  permissions: Permission[];
  dataFilters: DataFilter[];
  providerAccess: ProviderAccess[];
  
  // Routing preferences
  routingStrategy: 'cost-optimized' | 'performance-optimized' | 'compliance-first';
  preferredProviders: string[];
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  
  // GSI for efficient queries
  GSI1PK: string; // "ACTIVE_GROUPS"
  GSI1SK: string; // "GROUP#{groupId}"
}

// Product Catalog with Group-Based Access
interface ProductRecord {
  PK: string; // "PRODUCT#{productId}"
  SK: string; // "METADATA"
  
  // Product info
  productId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  
  // Access control
  accessLevel: 'public' | 'internal' | 'confidential';
  allowedGroups: string[];
  restrictedRegions: string[];
  
  // Business data
  availability: boolean;
  specifications: Record<string, any>;
  
  // GSI keys for group-based queries
  GSI1PK: string; // "CATEGORY#{category}"
  GSI1SK: string; // "PRICE#{price}"
  GSI2PK: string; // "ACCESS#{accessLevel}"
  GSI2SK: string; // "CATEGORY#{category}#PRODUCT#{productId}"
}
```

---

## 🔄 **SCALABILITY PATTERNS**

### **Horizontal Scaling Strategies**
```typescript
// Region-Based Scaling
class RegionAwareService {
  private regionConfigs = {
    'us-east-1': {
      primaryRegion: true,
      allowedGroups: ['global', 'us-teams'],
      dataResidency: 'US'
    },
    'eu-west-1': {
      primaryRegion: false,
      allowedGroups: ['global', 'eu-teams'],
      dataResidency: 'EU'
    }
  };
  
  async routeToRegion(userContext: UserContext): Promise<string> {
    // Route based on group data residency requirements
    const groupRegionRequirements = await this.getGroupRegionRequirements(userContext.groups);
    
    if (groupRegionRequirements.includes('EU_ONLY')) {
      return 'eu-west-1';
    }
    
    if (groupRegionRequirements.includes('US_ONLY')) {
      return 'us-east-1';
    }
    
    // Default to closest region
    return this.getClosestRegion(userContext.sourceIP);
  }
}

// Database Sharding by Group
class GroupBasedSharding {
  private shardConfigs = {
    'high-volume-groups': {
      shards: ['shard-1', 'shard-2', 'shard-3'],
      strategy: 'hash-based'
    },
    'low-volume-groups': {
      shards: ['shard-default'],
      strategy: 'single-shard'
    }
  };
  
  getShardForGroup(groupId: string): string {
    const groupVolume = this.getGroupVolume(groupId);
    
    if (groupVolume > 1000000) { // High volume
      const shardIndex = this.hashGroupId(groupId) % 3;
      return this.shardConfigs['high-volume-groups'].shards[shardIndex];
    }
    
    return this.shardConfigs['low-volume-groups'].shards[0];
  }
}
```

---

## 🎯 **INTERVIEW TALKING POINTS**

### **When Asked About Group-Based Access:**
```
"I implement multi-tier group-based access control where different teams 
get different permissions and data access levels. For example, the marketing 
team can access all product data for recommendations, but customer service 
only sees products relevant to support tickets. This is enforced at multiple 
layers - authentication, routing, and data filtering."
```

### **When Asked About Bedrock Cold Starts:**
```
"Bedrock cold starts are a real production challenge. I handle this with 
a multi-layered approach: predictive warm-up based on usage patterns, 
connection pooling to maintain persistent connections, intelligent routing 
to OpenAI during cold periods, and async processing for non-urgent requests. 
I also implement warm-up scheduling that keeps popular models active."
```

### **When Asked About Scaling:**
```
"The system scales through group-aware partitioning - high-volume groups 
get dedicated shards, different regions for compliance, and group-specific 
caching strategies. Each group can have different performance characteristics 
without affecting others."
```

---

## 🚀 **WHAT'S NEXT?**

You now have the complete technical foundation. Next, read:
- **03_RAG_VECTOR_KNOWLEDGE** - Fill knowledge gaps in RAG/OpenSearch
- **04_API_DATA_FLOWS** - Detailed request/response patterns
- **05_DEBUGGING_SCENARIOS** - Problem-solving practice

**Key Takeaway**: Your project already handles the complex scenarios they'll ask about. You just need to articulate the solutions clearly and systematically.

🎯 **You've built exactly what they need - now show them how it works!**