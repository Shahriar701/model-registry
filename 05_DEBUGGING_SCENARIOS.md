# 🐛 05. DEBUGGING SCENARIOS
## Real-World Problem Solving Practice

> **READ AFTER**: 04_API_DATA_FLOWS.md
> **PURPOSE**: Practice systematic debugging for interview problem-solving section

---

## 🎯 **DEBUGGING METHODOLOGY FRAMEWORK**

### **The STAR-D Method for Debugging:**
- **S**ituation: Understand the problem context
- **T**ask: Define what needs to be investigated  
- **A**ction: Systematic debugging approach
- **R**esult: Resolution and prevention measures
- **D**ocument: Lessons learned and monitoring improvements

### **Always Follow This Structure:**
1. **Clarify the Problem** (2-3 min)
2. **Gather Information** (5-7 min)  
3. **Form Hypothesis** (3-5 min)
4. **Systematic Investigation** (15-20 min)
5. **Propose Solution** (8-10 min)
6. **Prevention & Monitoring** (5 min)

---

## 🔥 **SCENARIO 1: Group-Based Access Control Failure**

### **Problem Statement:**
*"Users from the marketing team are getting 403 errors when trying to access product recommendations, but customer service team can access the same data fine. This started happening 2 hours ago after a deployment."*

### **Your Systematic Approach:**

#### **Step 1: Clarify the Problem (2-3 min)**
**What You Ask:**
```
"Let me understand this better:
1. Is this affecting ALL marketing team users or just some?
2. Are they getting 403s on all endpoints or just recommendations?
3. What was deployed 2 hours ago - was it related to auth or group permissions?
4. Can marketing users access other endpoints like product search?
5. Are there any error patterns in the logs with correlation IDs?"
```

#### **Step 2: Gather Information (5-7 min)**
**What You Say While Investigating:**
```
"Let me check several data points systematically:

First, I'll look at the authentication flow:
- Check API Gateway logs for 403 patterns
- Look at Lambda authorizer logs for marketing team users
- Verify DynamoDB API key table for group membership

Then I'll check the group permission system:
- Verify group configuration in the groups table
- Check if marketing team permissions changed
- Look at the deployment logs to see what changed

Finally, I'll check the application logic:
- Review the group-based filtering in the recommendation service
- Check if there are any new permission checks that were added"
```

#### **Step 3: Form Hypothesis (3-5 min)**
**Your Thinking Process:**
```
"Based on the timing and symptoms, I have a few hypotheses:

Hypothesis 1: The deployment changed group permission logic
- Marketing team permissions were modified or removed
- New permission checks were added that marketing doesn't have

Hypothesis 2: Database issue with group membership
- Marketing team group membership was accidentally modified
- Group configuration table has inconsistent data

Hypothesis 3: Caching issue
- Old permissions are cached and not reflecting new group rules
- Cache invalidation didn't work properly after deployment

Let me test these systematically..."
```

#### **Step 4: Systematic Investigation (15-20 min)**
**Your Investigation Process:**
```typescript
// Step 4a: Check Group Membership
"First, let me verify a marketing user's group membership:

1. Get a failing user's API key from the logs
2. Query the API key table to see their groups
3. Verify the groups table has correct permissions for marketing team

If I find that marketing users still have the right groups, then the issue 
is in the permission checking logic."

// Step 4b: Check Permission Logic
"Next, I'll trace through the permission checking:

1. Look at the Lambda authorizer code changes in the deployment
2. Check if new permission requirements were added
3. Verify the group permission aggregation logic

For example, if the code now requires 'recommendations:write' permission 
but marketing only has 'recommendations:read', that would cause 403s."

// Step 4c: Check Caching Issues
"Then I'll investigate caching:

1. Check if authorizer results are cached and stale
2. Look at Redis cache for group permission entries
3. Verify cache invalidation happened after the deployment

I can test this by making a request with cache-busting headers."

// Step 4d: Compare Working vs Failing Groups
"Finally, I'll compare customer service (working) vs marketing (failing):

1. Compare their group configurations side by side
2. Check what permissions customer service has that marketing doesn't
3. Look at the specific endpoint requirements for recommendations"
```

#### **Step 5: Root Cause & Solution (8-10 min)**
**Your Findings & Fix:**
```
"After investigation, I found the root cause:

The deployment added a new permission requirement 'recommendations:advanced' 
for the product recommendations endpoint. Customer service has this permission 
in their group configuration, but marketing team doesn't.

Immediate Fix:
1. Add 'recommendations:advanced' permission to marketing team group
2. Invalidate the group permission cache
3. Verify marketing users can now access recommendations

Long-term Fix:
1. Update deployment process to include permission impact analysis
2. Add automated tests for group permission changes
3. Implement gradual rollout for permission changes"
```

#### **Step 6: Prevention & Monitoring (5 min)**
```
"To prevent this in the future:

1. Add monitoring alerts for 403 error spikes by group
2. Create a permission compatibility check in CI/CD
3. Implement canary deployments for auth-related changes
4. Add group permission regression tests
5. Create a permission change approval process"
```

---

## 🔥 **SCENARIO 2: Bedrock Cold Start Cascade Failure**

### **Problem Statement:**
*"We're seeing a cascade failure where Bedrock cold starts are causing timeouts, which triggers circuit breakers, which routes traffic to OpenAI, but OpenAI is now getting overwhelmed and also timing out. Response times have gone from 2s to 30s."*

### **Your Systematic Approach:**

#### **Step 1: Clarify the Problem**
```
"Let me understand the failure pattern:
1. When did this cascade start and what triggered it?
2. What's the current traffic volume compared to normal?
3. Are both providers completely down or just slow?
4. What's the circuit breaker configuration - thresholds and timeouts?
5. Do we have any traffic that's still working normally?"
```

#### **Step 2: Gather Information**
```
"I need to check multiple systems:

Provider Health:
- Bedrock model warm-up status and recent cold start patterns
- OpenAI API rate limits and current usage
- Circuit breaker states for both providers

Traffic Patterns:
- Current request volume vs historical patterns
- Request distribution across models and user groups
- Queue depths and processing times

System Resources:
- Lambda concurrency usage and throttling
- DynamoDB performance and any throttling
- Cache hit ratios and Redis performance"
```

#### **Step 3: Investigation Process**
```typescript
// Check Provider Status
"First, let me check the provider health:

1. Look at Bedrock warm-up service logs
   - Are the scheduled warm-ups running?
   - What's the success rate of warm-up calls?
   - Are we warming up the right models?

2. Check OpenAI rate limiting
   - Are we hitting API rate limits?
   - What's our current usage vs limits?
   - Are we using multiple API keys effectively?

3. Examine circuit breaker behavior
   - What triggered the initial circuit breaker opening?
   - Are the thresholds too sensitive?
   - Is the half-open state working correctly?"

// Analyze Traffic Patterns
"Next, I'll analyze the traffic:

1. Check if there was a traffic spike
   - Did a particular user group suddenly increase usage?
   - Are we seeing retry storms from clients?
   - Is there a specific model causing issues?

2. Look at request queuing
   - Are requests backing up in SQS queues?
   - What's the Lambda concurrency utilization?
   - Are we hitting any service limits?"
```

#### **Step 4: Root Cause Analysis**
```
"After investigation, here's what I found:

Root Cause: A marketing campaign launched, causing 5x traffic increase. 
This overwhelmed our Bedrock warm-up strategy, causing cold starts. 
The circuit breaker opened and routed everything to OpenAI, which 
then hit rate limits and also failed.

Contributing Factors:
1. Warm-up service wasn't scaling with traffic patterns
2. Circuit breaker thresholds were too low for the traffic volume
3. OpenAI rate limits weren't configured for failover scenarios
4. No traffic shaping or queuing for sudden spikes"
```

#### **Step 5: Immediate & Long-term Solutions**
```
"Immediate Actions (next 15 minutes):
1. Manually warm up Bedrock models for high-traffic patterns
2. Increase circuit breaker thresholds temporarily
3. Enable request queuing to smooth traffic spikes
4. Route non-urgent requests to async processing

Short-term Fixes (next 2 hours):
1. Deploy additional OpenAI API keys for higher rate limits
2. Implement intelligent traffic shaping based on user tiers
3. Add predictive warm-up based on traffic forecasting
4. Implement request prioritization (enterprise users first)

Long-term Solutions (next week):
1. Auto-scaling warm-up service based on traffic patterns
2. Multi-region provider deployment for better capacity
3. Advanced circuit breaker with gradual recovery
4. Machine learning-based traffic prediction and pre-warming"
```

---

## 🔥 **SCENARIO 3: Group-Based Data Leakage**

### **Problem Statement:**
*"We discovered that some users in the EU marketing team are seeing product data from US-only products in their recommendations. This is a compliance violation. We need to find how this happened and ensure it never happens again."*

### **Your Systematic Approach:**

#### **Step 1: Immediate Response**
```
"This is a data compliance issue, so I need to act quickly:

1. Immediately audit the scope - how many users affected?
2. Identify which specific data was exposed
3. Check if this is still happening or was a past incident
4. Preserve logs and evidence for compliance reporting
5. Notify the compliance team while I investigate"
```

#### **Step 2: Investigation Strategy**
```typescript
// Data Flow Analysis
"I need to trace the complete data flow for EU marketing users:

1. Authentication: Verify EU marketing users have correct group membership
2. Authorization: Check if group permissions are properly enforced
3. Data Filtering: Examine how geographic restrictions are applied
4. Caching: Check if cache keys properly include geographic context
5. MCP Integration: Verify product search respects regional filters"

// Specific Checks
"Let me check each component:

API Gateway & Auth:
- Are EU users properly tagged with region in their group membership?
- Is the Lambda authorizer correctly identifying user regions?

Data Access Layer:
- Are DynamoDB queries including proper regional filters?
- Is the GSI structure supporting regional data isolation?

MCP Service:
- Are product search tools applying regional restrictions?
- Is the context injection respecting user geographic boundaries?

Caching Layer:
- Are cache keys including regional context?
- Could there be cache pollution between regions?"
```

#### **Step 3: Root Cause Discovery**
```
"After systematic investigation, I found the issue:

Root Cause: The MCP product search tool was not properly applying 
regional filters when user groups had multiple geographic permissions. 
EU marketing users also had 'global' group membership for some features, 
and the filtering logic was using OR instead of AND for regional restrictions.

Specific Issue:
- User has groups: ['eu-marketing', 'global-analytics']
- Product filtering logic: (region = EU OR region = GLOBAL)
- This incorrectly included US-only products marked as 'GLOBAL'

The caching layer then cached these mixed results, spreading the issue 
to other EU users."
```

#### **Step 4: Comprehensive Fix**
```typescript
// Immediate Fix
"Immediate actions taken:

1. Fixed the filtering logic to prioritize most restrictive regional rules
2. Invalidated all cached product data for EU users
3. Added explicit regional validation in MCP tools
4. Implemented audit logging for all cross-regional data access

// Code Fix Example
const getRegionalFilter = (userGroups: string[]): RegionalFilter => {
  // Get most restrictive regional requirement
  const regionalGroups = userGroups.filter(g => g.includes('eu-') || g.includes('us-'));
  
  if (regionalGroups.some(g => g.includes('eu-'))) {
    return { region: 'EU', restrictive: true };
  }
  
  if (regionalGroups.some(g => g.includes('us-'))) {
    return { region: 'US', restrictive: true };
  }
  
  return { region: 'GLOBAL', restrictive: false };
};"

// Long-term Prevention
"Prevention measures implemented:

1. Added automated compliance tests for regional data isolation
2. Implemented data classification and automatic regional tagging
3. Created compliance monitoring dashboard
4. Added regional data access audit trails
5. Implemented principle of least privilege for geographic access"
```

---

## 🔥 **SCENARIO 4: Vector Database Performance Degradation**

### **Problem Statement:**
*"Our RAG-enhanced product search is taking 15+ seconds to respond, up from the usual 2 seconds. Users are complaining that product recommendations are extremely slow. The vector database seems to be the bottleneck."*

### **Your Investigation Process:**

#### **Step 1: Performance Analysis**
```
"Let me analyze the performance bottleneck systematically:

1. Check OpenSearch cluster health and resource utilization
2. Analyze query patterns and complexity
3. Review indexing performance and any ongoing operations
4. Check if there are any hot shards or uneven data distribution
5. Examine network latency and connection pooling"
```

#### **Step 2: Detailed Investigation**
```typescript
// OpenSearch Cluster Analysis
"Checking OpenSearch performance:

1. Cluster Health:
   - Node status and resource utilization (CPU, memory, disk)
   - Shard allocation and any relocating shards
   - Index health and any red/yellow indices

2. Query Performance:
   - Slow query logs and query patterns
   - Vector search performance vs traditional search
   - Cache hit ratios and query complexity

3. Indexing Performance:
   - Any ongoing reindexing operations
   - Document ingestion rate and queue depth
   - Mapping changes or schema updates"

// Application Layer Analysis
"Checking application performance:

1. Connection Management:
   - Connection pool utilization and timeouts
   - Network latency to OpenSearch cluster
   - Connection recycling and keep-alive settings

2. Query Optimization:
   - Vector search parameters (k, ef, etc.)
   - Filter complexity and cardinality
   - Result set size and pagination

3. Caching Effectiveness:
   - Vector search result caching
   - Embedding cache hit ratios
   - Query result cache performance"
```

#### **Step 3: Root Cause & Solution**
```
"Root cause identified:

The vector index was not optimized for our query patterns. We were using 
default HNSW parameters that weren't tuned for our data size and query 
volume. Additionally, we had a hot shard problem where popular product 
categories were all on the same shard.

Immediate Fixes:
1. Rebalance shards to distribute load evenly
2. Optimize HNSW parameters for our data characteristics
3. Add query result caching with longer TTL
4. Implement query batching for similar requests

Performance Optimizations:
1. Tune vector index parameters (ef_construction, m)
2. Implement hybrid search with pre-filtering
3. Add query complexity limits and timeouts
4. Optimize embedding generation and caching"
```

---

## 🎯 **DEBUGGING INTERVIEW STRATEGY**

### **Key Phrases to Use:**
- "Let me approach this systematically..."
- "I need to gather more information about..."
- "My hypothesis is that..."
- "To verify this, I would..."
- "For immediate mitigation, I'd..."
- "To prevent this in the future..."

### **Always Show Your Process:**
1. **Ask clarifying questions** - Don't assume
2. **Think out loud** - Verbalize your reasoning
3. **Be systematic** - Follow a logical investigation order
4. **Consider multiple causes** - Don't fixate on first idea
5. **Think about prevention** - How to avoid it next time

### **Reference Your Project:**
- "In my implementation, I've seen similar issues when..."
- "Based on my experience with this architecture..."
- "I've handled this type of problem before by..."

---

## 🚀 **WHAT'S NEXT?**

You now have systematic debugging approaches for complex scenarios. Next:
- **06_FINAL_REVIEW_CHEAT_SHEET** - Last-minute reference and confidence building

**Key Takeaway**: Show systematic thinking, ask good questions, and always think about prevention. Your real project experience gives you credibility in discussing these scenarios.

🎯 **You're ready to tackle any debugging scenario they throw at you!**