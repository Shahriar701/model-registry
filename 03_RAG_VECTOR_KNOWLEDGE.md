# 🔍 03. RAG & VECTOR DATABASE KNOWLEDGE
## Master Your Knowledge Gaps: RAG, OpenSearch, Bedrock

> **READ AFTER**: 02_SYSTEM_DESIGN_DEEP_DIVE.md
> **PURPOSE**: Fill your knowledge gaps in RAG, vector databases, and Bedrock

---

## 🎯 **WHY RAG IS CRITICAL FOR IDEALO**

**The Problem RAG Solves:**
```
Without RAG:
User: "Find me gaming laptops under $1200"
LLM: "Here are some general features to look for in gaming laptops..."

With RAG:
User: "Find me gaming laptops under $1200"  
LLM: "Based on current inventory, here are 5 gaming laptops under $1200:
- ASUS ROG Strix G15 - $1,199 (RTX 3060, 16GB RAM) - In Stock
- MSI GF65 Thin - $999 (GTX 1660Ti, 8GB RAM) - 3 left
- Acer Nitro 5 - $899 (RTX 3050, 16GB RAM) - In Stock"
```

**RAG = Retrieval-Augmented Generation**
- **Retrieval**: Find relevant information from knowledge base
- **Augmented**: Enhance LLM prompt with retrieved context  
- **Generation**: LLM generates response using both training data and current context

---

## 🏗️ **RAG ARCHITECTURE IN YOUR SYSTEM**

### **Enhanced Architecture with RAG**
```
API Gateway → AI Gateway → RAG Pipeline → LLM Provider
                    ↓
              Vector Database ← Embedding Service
                    ↓
              Document Store (S3/DynamoDB)
```

### **RAG Pipeline Flow**
```typescript
// 1. Document Ingestion (Offline Process)
Document → Text Chunking → Generate Embeddings → Store in Vector DB

// 2. Query Processing (Real-time)
User Query → Generate Query Embedding → Vector Search → 
Retrieve Context → Enhance LLM Prompt → Generate Response
```

---

## 🔧 **IMPLEMENTING RAG WITH YOUR EXISTING ARCHITECTURE**

### **Step 1: Document Processing Pipeline**
```typescript
// Document Ingestion Service
class DocumentIngestionService {
  async ingestProductCatalog(): Promise<void> {
    // 1. Extract products from existing DynamoDB
    const products = await this.getAllProducts();
    
    // 2. Process each product into chunks
    for (const product of products) {
      const chunks = this.chunkProduct(product);
      
      // 3. Generate embeddings for each chunk
      for (const chunk of chunks) {
        const embedding = await this.generateEmbedding(chunk.content);
        
        // 4. Store in vector database
        await this.storeInVectorDB({
          id: `${product.productId}_${chunk.type}`,
          content: chunk.content,
          embedding: embedding,
          metadata: {
            productId: product.productId,
            chunkType: chunk.type,
            category: product.category,
            price: product.price,
            inStock: product.availability,
            accessLevel: product.accessLevel,
            allowedGroups: product.allowedGroups
          }
        });
      }
    }
  }
  
  private chunkProduct(product: Product): DocumentChunk[] {
    return [
      {
        type: 'overview',
        content: `${product.name}: ${product.description}. Price: ${product.price} ${product.currency}. Category: ${product.category}.`,
        metadata: { type: 'product_overview', productId: product.productId }
      },
      {
        type: 'specifications',
        content: `${product.name} specifications: ${JSON.stringify(product.specifications)}`,
        metadata: { type: 'product_specs', productId: product.productId }
      },
      {
        type: 'availability',
        content: `${product.name} availability: ${product.availability ? 'In Stock' : 'Out of Stock'}. Price: ${product.price}`,
        metadata: { type: 'product_availability', productId: product.productId }
      }
    ];
  }
}
```

### **Step 2: OpenSearch Vector Database Setup**
```typescript
// OpenSearch Vector Configuration
class OpenSearchVectorService {
  private indexMapping = {
    mappings: {
      properties: {
        content: { type: "text" },
        embedding: {
          type: "knn_vector",
          dimension: 1536,  // OpenAI embedding size
          method: {
            name: "hnsw",   // Hierarchical Navigable Small World
            space_type: "cosinesimil",
            engine: "nmslib",
            parameters: {
              ef_construction: 128,
              m: 24
            }
          }
        },
        metadata: {
          properties: {
            productId: { type: "keyword" },
            chunkType: { type: "keyword" },
            category: { type: "keyword" },
            price: { type: "float" },
            inStock: { type: "boolean" },
            accessLevel: { type: "keyword" },
            allowedGroups: { type: "keyword" }
          }
        }
      }
    }
  };
  
  async createIndex(indexName: string): Promise<void> {
    await this.client.indices.create({
      index: indexName,
      body: this.indexMapping
    });
  }
  
  async vectorSearch(
    query: string, 
    userContext: UserContext,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    
    // 1. Generate embedding for query
    const queryEmbedding = await this.generateEmbedding(query);
    
    // 2. Build search query with group-based filters
    const searchQuery = {
      size: options.limit || 10,
      query: {
        bool: {
          must: [
            {
              knn: {
                embedding: {
                  vector: queryEmbedding,
                  k: options.limit || 10
                }
              }
            }
          ],
          filter: this.buildGroupFilters(userContext)
        }
      },
      _source: ["content", "metadata"]
    };
    
    // 3. Execute search
    const response = await this.client.search({
      index: 'product-vectors',
      body: searchQuery
    });
    
    // 4. Transform results
    return response.body.hits.hits.map(hit => ({
      content: hit._source.content,
      score: hit._score,
      metadata: hit._source.metadata
    }));
  }
  
  private buildGroupFilters(userContext: UserContext): any[] {
    const filters = [];
    
    // Filter by access level
    const maxAccessLevel = this.getMaxAccessLevel(userContext.groups);
    filters.push({
      terms: {
        "metadata.accessLevel": this.getAllowedAccessLevels(maxAccessLevel)
      }
    });
    
    // Filter by group permissions
    if (userContext.groups.length > 0) {
      filters.push({
        bool: {
          should: [
            { terms: { "metadata.allowedGroups": userContext.groups } },
            { term: { "metadata.accessLevel": "public" } }
          ]
        }
      });
    }
    
    return filters;
  }
}
```

### **Step 3: Bedrock Integration for Embeddings**
```typescript
// Bedrock Embedding Service
class BedrockEmbeddingService {
  private client: BedrockRuntimeClient;
  private embeddingCache = new Map<string, number[]>();
  
  constructor() {
    this.client = new BedrockRuntimeClient({ region: 'us-east-1' });
  }
  
  async generateEmbedding(text: string): Promise<number[]> {
    // Check cache first
    const cacheKey = this.createCacheKey(text);
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }
    
    try {
      const command = new InvokeModelCommand({
        modelId: "amazon.titan-embed-text-v1",
        body: JSON.stringify({
          inputText: text
        }),
        contentType: "application/json"
      });
      
      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const embedding = responseBody.embedding;
      
      // Cache the result
      this.embeddingCache.set(cacheKey, embedding);
      
      return embedding;
    } catch (error) {
      console.error('Bedrock embedding generation failed:', error);
      throw new Error('Failed to generate embedding');
    }
  }
  
  private createCacheKey(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }
}
```

### **Step 4: RAG-Enhanced MCP Integration**
```typescript
// Enhanced MCP Service with RAG
class RAGEnhancedMCPService extends MCPContextService {
  constructor(
    private vectorService: OpenSearchVectorService,
    private embeddingService: BedrockEmbeddingService
  ) {
    super();
  }
  
  async injectMCPContext(
    request: LLMRequest,
    userContext: UserContext
  ): Promise<LLMRequest> {
    
    // 1. Extract intent from user query
    const userQuery = this.extractUserQuery(request.messages);
    const intent = await this.analyzeIntent(userQuery);
    
    // 2. Perform vector search for relevant context
    const vectorResults = await this.vectorService.vectorSearch(
      userQuery,
      userContext,
      { limit: 5 }
    );
    
    // 3. Perform traditional MCP tool execution
    const mcpResults = await this.executeMCPTools(intent, userContext);
    
    // 4. Combine vector search results with MCP results
    const combinedContext = this.combineResults(vectorResults, mcpResults);
    
    // 5. Format context for LLM
    const formattedContext = this.formatContextForLLM(combinedContext, userContext);
    
    // 6. Inject into request
    return this.enhanceRequestWithContext(request, formattedContext);
  }
  
  private combineResults(
    vectorResults: SearchResult[],
    mcpResults: MCPResult[]
  ): CombinedContext {
    
    return {
      semanticContext: vectorResults.map(result => ({
        content: result.content,
        relevanceScore: result.score,
        source: 'vector_search',
        metadata: result.metadata
      })),
      
      structuredData: mcpResults.map(result => ({
        tool: result.tool,
        data: result.data,
        source: 'mcp_tool',
        metadata: result.metadata
      })),
      
      combinedScore: this.calculateCombinedRelevance(vectorResults, mcpResults)
    };
  }
  
  private formatContextForLLM(
    context: CombinedContext,
    userContext: UserContext
  ): string {
    
    let formattedContext = "Based on current product information:\n\n";
    
    // Add semantic context from vector search
    if (context.semanticContext.length > 0) {
      formattedContext += "Relevant Product Information:\n";
      context.semanticContext.forEach((item, index) => {
        formattedContext += `${index + 1}. ${item.content}\n`;
      });
      formattedContext += "\n";
    }
    
    // Add structured data from MCP tools
    if (context.structuredData.length > 0) {
      formattedContext += "Current Product Catalog:\n";
      context.structuredData.forEach(item => {
        if (item.tool === 'product_search') {
          const products = item.data as Product[];
          products.forEach(product => {
            formattedContext += `- ${product.name}: ${product.price} ${product.currency} `;
            formattedContext += `(${product.availability ? 'In Stock' : 'Out of Stock'})\n`;
            formattedContext += `  ${product.description}\n`;
          });
        }
      });
    }
    
    // Add user context information
    formattedContext += `\nUser Context: ${userContext.groups.join(', ')} access level\n`;
    
    return formattedContext;
  }
}
```

---

## 🚀 **BEDROCK OPTIMIZATION STRATEGIES**

### **Advanced Cold Start Mitigation**
```typescript
// Predictive Warm-Up with Machine Learning
class PredictiveWarmUpService {
  private usagePatterns = new Map<string, UsagePattern>();
  
  async analyzeUsagePatterns(): Promise<void> {
    // Analyze historical usage data
    const historicalData = await this.getHistoricalUsage();
    
    // Build usage patterns by time, day, user group
    for (const record of historicalData) {
      const pattern = this.extractPattern(record);
      this.usagePatterns.set(pattern.key, pattern);
    }
  }
  
  async predictUpcomingUsage(): Promise<PredictionResult[]> {
    const currentTime = new Date();
    const predictions: PredictionResult[] = [];
    
    // Check patterns for current time window
    for (const [key, pattern] of this.usagePatterns) {
      const probability = this.calculateProbability(pattern, currentTime);
      
      if (probability > 0.7) { // 70% confidence threshold
        predictions.push({
          modelId: pattern.modelId,
          probability,
          expectedTime: this.calculateExpectedTime(pattern, currentTime),
          userGroups: pattern.userGroups
        });
      }
    }
    
    return predictions.sort((a, b) => b.probability - a.probability);
  }
  
  async proactiveWarmUp(): Promise<void> {
    const predictions = await this.predictUpcomingUsage();
    
    // Warm up models based on predictions
    for (const prediction of predictions.slice(0, 5)) { // Top 5 predictions
      await this.warmUpModel(prediction.modelId);
      
      // Record prediction accuracy for learning
      setTimeout(() => {
        this.recordPredictionAccuracy(prediction);
      }, prediction.expectedTime);
    }
  }
}

// Connection Pool with Health Monitoring
class AdvancedBedrockConnectionPool {
  private connections = new Map<string, ConnectionInfo>();
  private healthMonitor: HealthMonitor;
  
  constructor() {
    this.healthMonitor = new HealthMonitor();
    this.startHealthMonitoring();
  }
  
  async getHealthyConnection(region: string): Promise<BedrockRuntimeClient> {
    let connectionInfo = this.connections.get(region);
    
    // Check if connection exists and is healthy
    if (!connectionInfo || !await this.isConnectionHealthy(connectionInfo)) {
      connectionInfo = await this.createNewConnection(region);
      this.connections.set(region, connectionInfo);
    }
    
    // Update usage statistics
    connectionInfo.lastUsed = Date.now();
    connectionInfo.usageCount++;
    
    return connectionInfo.client;
  }
  
  private async createNewConnection(region: string): Promise<ConnectionInfo> {
    const client = new BedrockRuntimeClient({
      region,
      maxAttempts: 3,
      requestTimeout: 30000,
      requestHandler: {
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        // Connection pooling settings
        maxFreeSockets: 10,
        timeout: 30000,
        freeSocketTimeout: 30000
      }
    });
    
    // Test connection
    await this.testConnection(client);
    
    return {
      client,
      region,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      usageCount: 0,
      healthy: true,
      lastHealthCheck: Date.now()
    };
  }
  
  private async testConnection(client: BedrockRuntimeClient): Promise<void> {
    try {
      // Simple test call
      await client.send(new InvokeModelCommand({
        modelId: "amazon.titan-embed-text-v1",
        body: JSON.stringify({ inputText: "test" }),
        contentType: "application/json"
      }));
    } catch (error) {
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }
  
  private startHealthMonitoring(): void {
    setInterval(async () => {
      for (const [region, connectionInfo] of this.connections) {
        try {
          await this.testConnection(connectionInfo.client);
          connectionInfo.healthy = true;
          connectionInfo.lastHealthCheck = Date.now();
        } catch (error) {
          connectionInfo.healthy = false;
          console.warn(`Connection to ${region} is unhealthy:`, error.message);
        }
      }
    }, 60000); // Check every minute
  }
}
```

---

## 🎯 **INTERVIEW TALKING POINTS**

### **When Asked About RAG Implementation:**
```
"I implement RAG by combining vector search with structured data retrieval. 
When a user asks about products, I generate embeddings of their query, 
search our vector database for semantically similar content, and combine 
that with real-time product data from our MCP tools. This gives the LLM 
both semantic context and current factual information."
```

### **When Asked About Vector Database Choice:**
```
"I chose OpenSearch for vector storage because it integrates seamlessly 
with our AWS infrastructure and supports hybrid search - combining semantic 
similarity with traditional filters like price range and category. This 
lets me filter by user group permissions while maintaining semantic relevance."
```

### **When Asked About Bedrock vs OpenAI:**
```
"Bedrock offers cost advantages and data residency control, but has cold 
start challenges. I handle this with predictive warm-up based on usage 
patterns, connection pooling, and intelligent routing to OpenAI during 
cold periods. For embeddings, Bedrock Titan is cost-effective and performs 
well for our e-commerce use case."
```

### **When Asked About Group-Based RAG:**
```
"Different user groups need different data access. I implement this by 
storing group permissions in vector metadata and filtering search results 
based on user context. Marketing sees all products, customer service sees 
support-relevant data, and external partners see only public information."
```

---

## 🔧 **PRACTICAL IMPLEMENTATION STEPS**

### **Phase 1: Basic RAG Setup (Week 1)**
1. Set up OpenSearch cluster with vector mapping
2. Implement basic embedding generation with Bedrock
3. Create document ingestion pipeline for products
4. Build simple vector search functionality

### **Phase 2: Integration (Week 2)**
1. Integrate vector search with existing MCP service
2. Add group-based filtering to vector queries
3. Implement result combination and ranking
4. Test with real product data

### **Phase 3: Optimization (Week 3)**
1. Add embedding caching
2. Implement predictive warm-up for Bedrock
3. Optimize vector search performance
4. Add monitoring and metrics

### **Phase 4: Production Readiness (Week 4)**
1. Load testing and performance tuning
2. Error handling and fallback strategies
3. Monitoring and alerting setup
4. Documentation and runbooks

---

## 🚀 **WHAT'S NEXT?**

You now understand RAG and can integrate it with your existing system. Next:
- **04_API_DATA_FLOWS** - Detailed request/response patterns
- **05_DEBUGGING_SCENARIOS** - Problem-solving practice
- **06_FINAL_REVIEW_CHEAT_SHEET** - Last-minute reference

**Key Takeaway**: RAG enhances your existing MCP integration by adding semantic search capabilities. You're not replacing your system, you're making it smarter.

🎯 **You now have the knowledge to discuss RAG confidently in your interview!**