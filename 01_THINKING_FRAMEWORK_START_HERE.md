# 🧠 01. THINKING FRAMEWORK - START HERE
## Master the Mental Process for System Design Interviews

> **READ THIS FIRST** - This teaches you HOW to think and approach problems systematically

---

## 🎯 **WHY START HERE?**

Before diving into technical details, you need to master the **systematic thinking process**. This is what separates senior engineers from junior ones - not just knowing the answers, but knowing how to approach problems methodically.

---

## 🗣️ **THE GOLDEN FRAMEWORK: QCARDS Method**

### **Q**uestions - What should I ask?
### **C**larification - What do I need to understand?
### **A**rchitecture - How do I structure this?
### **R**equirements - What are the constraints?
### **D**esign - How do I implement this?
### **S**cale - How do I make it production-ready?

---

## 🎯 **STEP-BY-STEP INTERVIEW APPROACH**

### **Phase 1: Requirements Gathering (5-7 minutes)**

**Your Internal Monologue:**
> "They want me to design an AI platform. This sounds like my project, but I need to understand their specific requirements first. Let me not jump to solutions."

**What You Say Out Loud:**
```
"Great! This sounds like an interesting challenge. Before I start designing, 
let me make sure I understand the requirements correctly. 

Can I ask a few clarifying questions to better understand the scope?"
```

**The Questions You MUST Ask:**
```
1. "What's the expected scale? Are we talking about hundreds of requests 
   per day or millions?"

2. "Should this support multiple LLM providers, or can we start with one?"

3. "Do we need real-time responses, or is some latency acceptable?"

4. "Are there any specific security or compliance requirements?"

5. "Should we integrate with existing e-commerce data, or is this 
   a greenfield project?"

6. "Do different user groups need different access levels or data?"
```

**Your Internal Processing:**
> "Based on their answers, I can see this maps to my project. They want scale (millions), multiple providers (OpenAI + Bedrock), real-time responses, enterprise security, and e-commerce integration. Perfect - this is exactly what I built!"

### **Phase 2: High-Level Architecture (10-12 minutes)**

**Your Thinking Process:**
> "Okay, I need to break this down into logical components. What are the main pieces I need?"

**What You Say While Drawing:**
```
"Let me start with the high-level architecture. I'm thinking about this 
in layers:

1. First, I need an entry point - that's going to be an API Gateway
2. Then I need the core logic - that's my AI Gateway service  
3. I need to route to different LLM providers
4. I need to integrate with e-commerce data
5. And I need storage for configuration and caching

Let me draw this out..."
```

**The Architecture You Draw:**
```
┌─────────────────────────────────────────────────────────────┐
│                    IDEALO AI PLATFORM                      │
├─────────────────────────────────────────────────────────────┤
│  Web UI/CLI  │  Mobile Apps  │  Internal Services          │
└──────┬───────┴───────┬───────┴─────────┬───────────────────┘
       │               │                 │
┌──────▼───────────────▼─────────────────▼───────────────────┐
│                 API GATEWAY + WAF                          │
│  • Authentication  • Rate Limiting  • Request Routing     │
└──────┬───────────────┬─────────────────┬───────────────────┘
       │               │                 │
┌──────▼──────┐ ┌──────▼──────┐ ┌────────▼──────────────────┐
│   AI MODEL  │ │   MODEL     │ │      MCP SERVER           │
│   GATEWAY   │ │   REGISTRY  │ │  (Product Data Bridge)    │
└──────┬──────┘ └──────┬──────┘ └────────┬──────────────────┘
       │               │                 │
┌──────▼──────────────────────────────────▼─────────────────┐
│              PROVIDER ROUTING LAYER                       │
│  OpenAI  │  AWS Bedrock  │  Circuit Breakers  │  Cache   │
└───────────────────────────────────────────────────────────┘
```

**While Drawing, You Explain:**
```
[Drawing API Gateway]
"So users come in through an API Gateway. This gives me built-in 
rate limiting, authentication, and request routing."

[Drawing AI Gateway Service]  
"The core service handles the business logic - request validation,
provider selection, and response processing."

[Drawing Provider Layer]
"I'll have multiple LLM providers - OpenAI and AWS Bedrock for 
redundancy and cost optimization."

[Drawing Data Integration]
"For e-commerce integration, I'm thinking of using MCP - Model Context 
Protocol - to bridge structured product data with LLM requests."
```

### **Phase 3: Deep Dive Components (15-20 minutes)**

**Component 1: Authentication & Group-Based Access Control**

**Your Thinking Process:**
> "They asked about different user groups needing different access. This is a perfect opportunity to show I understand enterprise security patterns."

**What You Say:**
```
"Let me dive deeper into the authentication layer since you mentioned 
different user groups needing different access levels.

I'm thinking of a multi-tier authentication system:

1. API Key Authentication with different tiers:
   - Free tier: 10 requests/minute, basic models only
   - Basic tier: 100 requests/minute, standard models
   - Enterprise: 10,000 requests/minute, all models + premium features

2. Group-Based Access Control:
   - Marketing team: Access to product recommendation models
   - Customer service: Access to support-focused models + customer data
   - Data science team: Access to all models + model registry
   - External partners: Limited access to specific endpoints

3. Data Access Isolation:
   - Each group sees only their relevant product catalogs
   - Customer service can access customer data, marketing cannot
   - Geographic restrictions (EU users see EU-compliant models only)
```

**While Drawing the Auth Flow:**
```
"The flow would be:
1. Request comes in with X-API-Key header
2. API Gateway calls Lambda authorizer
3. Authorizer checks DynamoDB for key validity, tier, and group membership
4. Returns policy with specific permissions and data access rules
5. Request proceeds with user context including group permissions
6. Each service checks group permissions before processing"
```

**Component 2: Group-Based Routing Logic**

**Your Thinking Process:**
> "Now I need to explain how different groups get routed to different resources based on their permissions."

**What You Say:**
```
"For group-based routing, I implement a permission-aware routing system:

1. Request Context Enrichment:
   - After authentication, I enrich the request with group context
   - This includes: group ID, permissions, data access rules, model access

2. Provider Selection Based on Group:
   - Enterprise groups: Access to premium models (GPT-4, Claude-3)
   - Basic groups: Cost-optimized routing to cheaper models
   - Geographic groups: Route to region-specific providers for compliance

3. Data Filtering by Group:
   - Marketing: See all products, pricing data
   - Customer Service: See products + customer interaction history
   - External Partners: See only public product information
   - Regional Teams: See only region-specific product catalogs

4. MCP Context Injection by Group:
   - Different groups get different product data contexts
   - Customer service gets support-relevant product info
   - Marketing gets recommendation-relevant data
```

**Component 3: Bedrock Cold Start Optimization**

**Your Thinking Process:**
> "They specifically asked about Bedrock cold starts. This is a great opportunity to show I understand production challenges and have solutions."

**What You Say:**
```
"Great question about Bedrock cold starts! This is a real production challenge 
I've dealt with. Here's my multi-layered approach:

1. Connection Pooling and Keep-Alive:
   - Maintain persistent connections to Bedrock
   - Use connection pooling to avoid connection overhead
   - Implement keep-alive pings to prevent connection timeouts

2. Model Warm-Up Strategy:
   - Scheduled Lambda functions that ping Bedrock models every 5 minutes
   - Rotate through different models to keep them warm
   - Use CloudWatch Events to trigger warm-up calls

3. Intelligent Provider Selection:
   - Track cold start patterns by time of day and model
   - Route to OpenAI during Bedrock cold periods
   - Implement predictive warm-up based on usage patterns

4. Async Processing for Non-Critical Requests:
   - Queue non-urgent requests during cold start periods
   - Process them when Bedrock is warm
   - Use SQS + Lambda for async processing

5. Caching Strategy:
   - Aggressive caching of Bedrock responses (longer TTL)
   - Cache similar requests to reduce Bedrock calls
   - Pre-compute common responses during warm periods
```

**Code Example You Can Draw:**
```typescript
// Bedrock Warm-Up Service
class BedrockWarmUpService {
  private warmUpSchedule = {
    'anthropic.claude-3-sonnet': '*/5 * * * *', // Every 5 minutes
    'amazon.titan-text-express': '*/3 * * * *', // Every 3 minutes
  };
  
  async warmUpModel(modelId: string) {
    const warmUpRequest = {
      modelId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }]
      })
    };
    
    try {
      await this.bedrockClient.send(new InvokeModelCommand(warmUpRequest));
      await this.recordWarmUpSuccess(modelId);
    } catch (error) {
      await this.recordWarmUpFailure(modelId, error);
    }
  }
}

// Smart Provider Selection with Cold Start Awareness
class SmartProviderRouter {
  async selectProvider(request: LLMRequest): Promise<Provider> {
    const providers = await this.getAvailableProviders(request.model);
    
    // Check Bedrock warm status
    const bedrockProvider = providers.find(p => p.name === 'bedrock');
    if (bedrockProvider) {
      const isWarm = await this.isBedrockWarm(request.model);
      if (!isWarm) {
        // Route to OpenAI if Bedrock is cold and request is urgent
        if (request.priority === 'high') {
          return providers.find(p => p.name === 'openai') || bedrockProvider;
        }
        // Queue for async processing if not urgent
        await this.queueForAsyncProcessing(request);
        return null;
      }
    }
    
    return this.selectOptimalProvider(providers, request);
  }
}
```

### **Phase 4: Addressing Scalability (8-10 minutes)**

**Your Thinking Process:**
> "Now I need to show I understand how to scale this for millions of users with different access patterns."

**What You Say:**
```
"For scaling with group-based access, I need to consider several factors:

1. Database Partitioning by Group:
   - Partition API keys table by group ID for faster lookups
   - Separate product catalogs by region/group for data isolation
   - Use DynamoDB GSIs for efficient group-based queries

2. Caching Strategy by Group:
   - Group-specific cache keys to prevent data leakage
   - Different TTL policies for different groups (enterprise gets fresher data)
   - Cache invalidation patterns that respect group boundaries

3. Provider Scaling by Group:
   - Dedicated API keys per group for better rate limit management
   - Group-specific circuit breakers (don't let one group affect others)
   - Load balancing that considers group quotas and priorities

4. Geographic Distribution:
   - Deploy in multiple regions for compliance (EU data stays in EU)
   - Route groups to appropriate regions automatically
   - Replicate group configurations across regions
```

---

## 🎯 **KEY PHRASES TO USE**

### **When Starting:**
- "Let me make sure I understand the requirements correctly..."
- "Can I ask a few clarifying questions?"
- "Before I start designing, I want to understand..."

### **When Thinking:**
- "I'm thinking about this in layers..."
- "Let me break this down into logical components..."
- "There are a few ways I could approach this..."

### **When Explaining:**
- "In my implementation, I found that..."
- "Based on similar systems I've built..."
- "The trade-off here is..."

### **When Uncertain:**
- "I haven't worked extensively with this specific tool, but based on similar systems..."
- "Let me think through the trade-offs of each option..."
- "There are a few considerations here..."

---

## 🚀 **PRACTICE EXERCISE**

**Set a timer for 10 minutes and practice this out loud:**

1. **Scenario**: "Design an AI platform for e-commerce with group-based access control"
2. **Your task**: Go through the first 3 phases using the framework above
3. **Focus on**: Asking questions, thinking out loud, explaining your reasoning

**Key Success Metrics:**
- Did you ask clarifying questions first?
- Did you think out loud while drawing?
- Did you reference your actual project experience?
- Did you address the specific concerns (group access, Bedrock cold starts)?

---

## 🎯 **WHAT'S NEXT?**

After mastering this thinking framework, you'll read:
- **02_SYSTEM_DESIGN_DEEP_DIVE** - Technical implementation details
- **03_RAG_VECTOR_KNOWLEDGE** - Fill your knowledge gaps
- **04_API_DATA_FLOWS** - Detailed workflows and patterns
- **05_DEBUGGING_SCENARIOS** - Problem-solving practice
- **06_FINAL_REVIEW_CHEAT_SHEET** - Last-minute reference

**Remember**: The goal isn't to memorize answers, but to internalize the systematic thinking process. This framework works for ANY system design question, not just AI platforms.

🎯 **Master this thinking process first, then move to the technical details!**