# ⚙️ 07. KUBERNETES & EKS INTEGRATION
## Extending Your Project to Container Orchestration

> **READ AFTER**: 06_FINAL_REVIEW_CHEAT_SHEET.md
> **PURPOSE**: Cover Kubernetes/EKS deployment scenarios for idealo interview

---

## 🎯 **WHY KUBERNETES MATTERS FOR IDEALO**

### **Current Architecture (Serverless):**
```
API Gateway → Lambda Functions → DynamoDB/Redis
```

### **Extended Architecture (Hybrid Serverless + Kubernetes):**
```
API Gateway → Lambda Gateway → EKS Cluster (ML Models) + Lambda (API Logic)
                    ↓              ↓
              Model Registry → Kubernetes Deployments
                    ↓              ↓
              DynamoDB + Redis + S3 + EKS Storage
```

### **Why Add Kubernetes to Your Project:**
1. **ML Model Serving**: Complex models need more resources than Lambda's 15-minute limit
2. **Long-Running Processes**: Model training, batch inference, data processing
3. **GPU Workloads**: ML inference with GPU acceleration
4. **Stateful Services**: Vector databases, model caches, persistent connections
5. **Cost Optimization**: Better resource utilization for predictable workloads

---

## 🏗️ **KUBERNETES INTEGRATION WITH YOUR EXISTING SYSTEM**

### **Hybrid Architecture Design:**
```typescript
// Your existing serverless components (keep these)
interface ServerlessComponents {
  apiGateway: 'Request routing, authentication, rate limiting';
  lambdaGateway: 'Business logic, provider routing, MCP integration';
  modelRegistry: 'Model metadata management';
  dynamoDB: 'Metadata storage';
  redis: 'Caching layer';
}

// New Kubernetes components (add these)
interface KubernetesComponents {
  modelServing: 'Deploy registered models as microservices';
  batchProcessing: 'Large-scale data processing jobs';
  vectorDatabase: 'Self-hosted vector search (alternative to OpenSearch)';
  mlPipelines: 'Model training and evaluation workflows';
  monitoring: 'Prometheus, Grafana for container metrics';
}
```

### **Integration Points:**
```typescript
// 1. Model Registry → Kubernetes Deployment
interface ModelDeploymentFlow {
  step1: 'Model registered in DynamoDB via Lambda';
  step2: 'EventBridge triggers Kubernetes deployment';
  step3: 'Kubernetes operator creates model serving pods';
  step4: 'Service mesh routes traffic to model endpoints';
  step5: 'Model Registry updates status to DEPLOYED';
}

// 2. API Gateway → Kubernetes Services
interface RequestRouting {
  lightweightRequests: 'Route to Lambda (fast, stateless)';
  heavyMLInference: 'Route to EKS pods (GPU, long-running)';
  batchProcessing: 'Route to Kubernetes Jobs';
  realTimeML: 'Route to EKS model serving endpoints';
}
```

---

## 🚀 **EKS CLUSTER DESIGN FOR YOUR PROJECT**

### **Cluster Architecture:**
```yaml
# EKS Cluster Configuration
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: idealo-ai-platform
  region: us-east-1
  version: "1.28"

# Node Groups for different workloads
nodeGroups:
  # General purpose nodes for API services
  - name: general-purpose
    instanceType: m5.large
    minSize: 2
    maxSize: 10
    desiredCapacity: 3
    labels:
      workload-type: general
    taints:
      - key: workload-type
        value: general
        effect: NoSchedule

  # GPU nodes for ML inference
  - name: gpu-inference
    instanceType: g4dn.xlarge
    minSize: 0
    maxSize: 5
    desiredCapacity: 1
    labels:
      workload-type: gpu-ml
    taints:
      - key: nvidia.com/gpu
        value: "true"
        effect: NoSchedule

  # Memory-optimized for vector databases
  - name: memory-optimized
    instanceType: r5.2xlarge
    minSize: 1
    maxSize: 3
    desiredCapacity: 2
    labels:
      workload-type: memory-intensive

# Add-ons
addons:
  - name: vpc-cni
  - name: coredns
  - name: kube-proxy
  - name: aws-load-balancer-controller
  - name: cluster-autoscaler
  - name: nvidia-device-plugin  # For GPU support
```

### **Namespace Organization:**
```yaml
# Namespace structure for multi-tenancy
apiVersion: v1
kind: Namespace
metadata:
  name: ai-platform-core
  labels:
    tier: core
---
apiVersion: v1
kind: Namespace
metadata:
  name: model-serving
  labels:
    tier: ml-inference
---
apiVersion: v1
kind: Namespace
metadata:
  name: batch-processing
  labels:
    tier: batch-jobs
---
apiVersion: v1
kind: Namespace
metadata:
  name: monitoring
  labels:
    tier: observability
```

---

## 🔄 **MODEL DEPLOYMENT WORKFLOW**

### **From Model Registry to Kubernetes:**
```typescript
// Enhanced Model Registry with Kubernetes Integration
class KubernetesModelDeploymentService {
  async deployModelToEKS(
    modelId: string,
    version: string,
    deploymentConfig: EKSDeploymentConfig
  ): Promise<DeploymentResult> {
    
    // 1. Get model metadata from registry
    const model = await this.modelRegistry.getModel(modelId, version);
    
    // 2. Generate Kubernetes manifests
    const manifests = await this.generateKubernetesManifests(model, deploymentConfig);
    
    // 3. Deploy to EKS cluster
    const deployment = await this.deployToCluster(manifests);
    
    // 4. Set up service mesh routing
    await this.configureServiceMesh(model, deployment);
    
    // 5. Update model registry status
    await this.updateModelStatus(modelId, version, 'DEPLOYED', {
      kubernetesDeployment: deployment.name,
      endpoint: deployment.serviceEndpoint,
      replicas: deployment.replicas
    });
    
    return deployment;
  }
  
  private async generateKubernetesManifests(
    model: ModelRegistration,
    config: EKSDeploymentConfig
  ): Promise<KubernetesManifests> {
    
    // Deployment manifest
    const deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: `model-${model.modelId}-${model.version}`,
        namespace: 'model-serving',
        labels: {
          'app': 'model-serving',
          'model-id': model.modelId,
          'model-version': model.version,
          'framework': model.framework,
          'team': model.teamId
        }
      },
      spec: {
        replicas: config.replicas || 2,
        selector: {
          matchLabels: {
            'app': 'model-serving',
            'model-id': model.modelId,
            'model-version': model.version
          }
        },
        template: {
          metadata: {
            labels: {
              'app': 'model-serving',
              'model-id': model.modelId,
              'model-version': model.version
            }
          },
          spec: {
            containers: [{
              name: 'model-server',
              image: this.getModelServingImage(model.framework),
              ports: [{ containerPort: 8080 }],
              env: [
                { name: 'MODEL_S3_URI', value: model.s3Uri },
                { name: 'MODEL_ID', value: model.modelId },
                { name: 'MODEL_VERSION', value: model.version },
                { name: 'FRAMEWORK', value: model.framework }
              ],
              resources: {
                requests: {
                  cpu: config.cpuRequest || '500m',
                  memory: config.memoryRequest || '1Gi'
                },
                limits: {
                  cpu: config.cpuLimit || '2',
                  memory: config.memoryLimit || '4Gi'
                }
              },
              livenessProbe: {
                httpGet: { path: '/health', port: 8080 },
                initialDelaySeconds: 30,
                periodSeconds: 10
              },
              readinessProbe: {
                httpGet: { path: '/ready', port: 8080 },
                initialDelaySeconds: 5,
                periodSeconds: 5
              }
            }],
            nodeSelector: this.getNodeSelector(config),
            tolerations: this.getTolerations(config)
          }
        }
      }
    };
    
    // Service manifest
    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: `model-${model.modelId}-${model.version}-service`,
        namespace: 'model-serving'
      },
      spec: {
        selector: {
          'app': 'model-serving',
          'model-id': model.modelId,
          'model-version': model.version
        },
        ports: [{
          port: 80,
          targetPort: 8080,
          protocol: 'TCP'
        }],
        type: 'ClusterIP'
      }
    };
    
    // Horizontal Pod Autoscaler
    const hpa = {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: {
        name: `model-${model.modelId}-${model.version}-hpa`,
        namespace: 'model-serving'
      },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: `model-${model.modelId}-${model.version}`
        },
        minReplicas: config.minReplicas || 1,
        maxReplicas: config.maxReplicas || 10,
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              target: {
                type: 'Utilization',
                averageUtilization: 70
              }
            }
          },
          {
            type: 'Resource',
            resource: {
              name: 'memory',
              target: {
                type: 'Utilization',
                averageUtilization: 80
              }
            }
          }
        ]
      }
    };
    
    return { deployment, service, hpa };
  }
}
```

### **Service Mesh Integration (Istio):**
```yaml
# Virtual Service for model routing
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: model-serving-routing
  namespace: model-serving
spec:
  hosts:
  - model-serving.idealo.internal
  http:
  - match:
    - headers:
        model-id:
          exact: "fraud-detection"
        model-version:
          exact: "v1.2.0"
    route:
    - destination:
        host: model-fraud-detection-v1-2-0-service
        port:
          number: 80
      weight: 100
  - match:
    - headers:
        team:
          exact: "marketing"
    route:
    - destination:
        host: model-recommendation-engine-service
        port:
          number: 80
---
# Destination Rule for load balancing
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: model-serving-destination
  namespace: model-serving
spec:
  host: model-serving.idealo.internal
  trafficPolicy:
    loadBalancer:
      simple: LEAST_CONN
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 50
        maxRequestsPerConnection: 10
    circuitBreaker:
      consecutiveErrors: 5
      interval: 30s
      baseEjectionTime: 30s
```

---

## 🔄 **GROUP-BASED ROUTING IN KUBERNETES**

### **Enhanced Routing with Kubernetes:**
```typescript
// Extended Provider Router with Kubernetes Integration
class HybridProviderRouter extends ProviderRouter {
  async selectProvider(
    request: LLMRequest,
    userContext: UserContext
  ): Promise<ProviderAdapter | KubernetesEndpoint> {
    
    // 1. Determine if request needs Kubernetes or Lambda
    const routingDecision = await this.determineRoutingTarget(request, userContext);
    
    if (routingDecision.target === 'kubernetes') {
      return await this.selectKubernetesEndpoint(request, userContext, routingDecision);
    }
    
    // Fallback to existing Lambda-based providers
    return await super.selectProvider(request, userContext);
  }
  
  private async determineRoutingTarget(
    request: LLMRequest,
    userContext: UserContext
  ): Promise<RoutingDecision> {
    
    // Route to Kubernetes if:
    // 1. Request requires GPU processing
    // 2. Model is deployed on Kubernetes
    // 3. User group has Kubernetes access
    // 4. Request is for batch processing
    
    const requiresGPU = this.requiresGPUProcessing(request);
    const modelOnK8s = await this.isModelDeployedOnKubernetes(request.model);
    const hasK8sAccess = this.hasKubernetesAccess(userContext.groups);
    const isBatchRequest = request.metadata?.batch === true;
    
    if ((requiresGPU || modelOnK8s || isBatchRequest) && hasK8sAccess) {
      return {
        target: 'kubernetes',
        reason: requiresGPU ? 'gpu-required' : modelOnK8s ? 'model-location' : 'batch-processing',
        priority: this.getGroupPriority(userContext.groups)
      };
    }
    
    return { target: 'lambda', reason: 'default-routing' };
  }
  
  private async selectKubernetesEndpoint(
    request: LLMRequest,
    userContext: UserContext,
    routingDecision: RoutingDecision
  ): Promise<KubernetesEndpoint> {
    
    // Get available Kubernetes services for this model
    const availableServices = await this.getKubernetesServices(request.model, userContext);
    
    // Apply group-based filtering
    const allowedServices = availableServices.filter(service => 
      this.canAccessKubernetesService(service, userContext.groups)
    );
    
    if (allowedServices.length === 0) {
      throw new Error('No accessible Kubernetes services for this request');
    }
    
    // Select based on group priority and resource availability
    const selectedService = this.selectOptimalKubernetesService(
      allowedServices,
      userContext,
      routingDecision.priority
    );
    
    return {
      type: 'kubernetes',
      serviceName: selectedService.name,
      namespace: selectedService.namespace,
      endpoint: selectedService.endpoint,
      headers: {
        'X-User-Groups': userContext.groups.join(','),
        'X-Priority': routingDecision.priority.toString(),
        'X-Correlation-ID': request.metadata?.correlationId
      }
    };
  }
  
  private hasKubernetesAccess(groups: string[]): boolean {
    // Define which groups can access Kubernetes resources
    const k8sEnabledGroups = [
      'data-science-team',
      'ml-engineers',
      'enterprise-users',
      'gpu-users'
    ];
    
    return groups.some(group => k8sEnabledGroups.includes(group));
  }
  
  private getGroupPriority(groups: string[]): number {
    // Higher priority for premium groups
    const priorityMap = {
      'enterprise-users': 10,
      'data-science-team': 8,
      'ml-engineers': 7,
      'premium-users': 5,
      'basic-users': 1
    };
    
    return Math.max(...groups.map(group => priorityMap[group] || 0));
  }
}
```

### **Kubernetes RBAC for Group-Based Access:**
```yaml
# Role for model serving access
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: model-serving
  name: model-serving-access
rules:
- apiGroups: [""]
  resources: ["services", "endpoints"]
  verbs: ["get", "list"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list"]

---
# RoleBinding for data science team
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: data-science-model-access
  namespace: model-serving
subjects:
- kind: User
  name: data-science-team
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: model-serving-access
  apiGroup: rbac.authorization.k8s.io

---
# ClusterRole for ML engineers (broader access)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ml-engineer-access
rules:
- apiGroups: [""]
  resources: ["pods", "services", "configmaps"]
  verbs: ["get", "list", "create", "update", "delete"]
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets"]
  verbs: ["get", "list", "create", "update", "delete"]
- apiGroups: ["batch"]
  resources: ["jobs", "cronjobs"]
  verbs: ["get", "list", "create", "update", "delete"]
```

---

## 📊 **MONITORING & OBSERVABILITY IN KUBERNETES**

### **Prometheus + Grafana Setup:**
```yaml
# Prometheus configuration for model serving metrics
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: monitoring
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
    scrape_configs:
    - job_name: 'model-serving'
      kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
          - model-serving
      relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
    
    - job_name: 'istio-mesh'
      kubernetes_sd_configs:
      - role: endpoints
        namespaces:
          names:
          - istio-system
      relabel_configs:
      - source_labels: [__meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
        action: keep
        regex: istio-proxy;http-monitoring
```

### **Custom Metrics for Group-Based Monitoring:**
```typescript
// Kubernetes metrics collector
class KubernetesMetricsCollector {
  async recordModelInference(
    modelId: string,
    version: string,
    userGroup: string,
    latency: number,
    success: boolean
  ): Promise<void> {
    
    // Prometheus metrics
    this.prometheusRegistry.getSingleMetric('model_inference_duration_seconds')
      .labels({ model_id: modelId, version, user_group: userGroup })
      .observe(latency / 1000);
    
    this.prometheusRegistry.getSingleMetric('model_inference_total')
      .labels({ model_id: modelId, version, user_group: userGroup, status: success ? 'success' : 'error' })
      .inc();
    
    // Custom CloudWatch metrics for AWS integration
    await this.cloudWatchClient.putMetricData({
      Namespace: 'AiPlatform/Kubernetes',
      MetricData: [{
        MetricName: 'ModelInferenceLatency',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'Version', Value: version },
          { Name: 'UserGroup', Value: userGroup },
          { Name: 'ClusterName', Value: process.env.CLUSTER_NAME }
        ],
        Value: latency,
        Unit: 'Milliseconds',
        Timestamp: new Date()
      }]
    }).promise();
  }
}
```

---

## 🎯 **INTERVIEW TALKING POINTS FOR KUBERNETES**

### **When Asked About Container Orchestration:**
```
"While my current implementation uses serverless Lambda functions for the API layer, 
I designed it to be extensible to Kubernetes for ML model serving. For compute-intensive 
ML workloads that need GPU acceleration or longer processing times, I would deploy 
models as containerized services on EKS.

The hybrid approach gives us the best of both worlds - serverless for API logic 
and request routing, Kubernetes for resource-intensive ML inference."
```

### **When Asked About Scaling ML Models:**
```
"For ML model scaling, Kubernetes provides better resource management than Lambda's 
15-minute limit. I would use Horizontal Pod Autoscaling based on CPU/memory usage 
and custom metrics like request queue depth. Different user groups could get 
different resource allocations and priorities through Kubernetes resource quotas."
```

### **When Asked About Multi-Tenancy:**
```
"I implement multi-tenancy in Kubernetes through namespaces, RBAC, and resource 
quotas. Each team gets their own namespace with appropriate resource limits. 
Service mesh (Istio) handles traffic routing based on user groups, ensuring 
data isolation and proper access control."
```

---

## 🚀 **WHAT'S NEXT?**

Now you have comprehensive Kubernetes knowledge integrated with your project. The next file will be the practical debugging scenarios you can actually implement and test.

**Key Takeaway**: Your serverless architecture can be extended to hybrid serverless + Kubernetes for ML workloads, giving you the flexibility to handle any scale and compute requirements.

🎯 **You now have both serverless AND container orchestration expertise!**