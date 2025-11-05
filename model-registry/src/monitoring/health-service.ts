import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Logger } from '../utils/logger';
import { MetricsService } from './metrics-service';

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  error?: string;
  details?: Record<string, any>;
}

export interface SystemHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  dependencies: HealthCheckResult[];
  summary: {
    healthy: number;
    unhealthy: number;
    degraded: number;
    total: number;
  };
}

export interface AlertingConfig {
  enabled: boolean;
  thresholds: {
    responseTime: number; // milliseconds
    errorRate: number; // percentage
    consecutiveFailures: number;
  };
}

export class HealthService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly s3Client: S3Client;
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly logger: Logger;
  private readonly metricsService: MetricsService;
  private readonly tableName: string;
  private readonly startTime: number;
  private readonly version: string;
  private readonly alertingConfig: AlertingConfig;

  constructor(metricsService: MetricsService) {
    const dynamoDBClient = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(dynamoDBClient);
    this.s3Client = new S3Client({});
    this.cloudWatchClient = new CloudWatchClient({});
    this.logger = new Logger();
    this.metricsService = metricsService;
    this.tableName = process.env.MODELS_TABLE_NAME!;
    this.startTime = Date.now();
    this.version = process.env.SERVICE_VERSION || '1.0.0';
    
    this.alertingConfig = {
      enabled: process.env.HEALTH_ALERTING_ENABLED === 'true',
      thresholds: {
        responseTime: parseInt(process.env.HEALTH_RESPONSE_TIME_THRESHOLD || '5000'),
        errorRate: parseFloat(process.env.HEALTH_ERROR_RATE_THRESHOLD || '5.0'),
        consecutiveFailures: parseInt(process.env.HEALTH_CONSECUTIVE_FAILURES_THRESHOLD || '3'),
      },
    };
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(correlationId: string): Promise<SystemHealth> {
    this.logger.info('Starting comprehensive health check', { correlationId });
    
    const startTime = Date.now();
    const dependencies: HealthCheckResult[] = [];

    // Check all dependencies in parallel
    const healthChecks = [
      this.checkDynamoDB(correlationId),
      this.checkCloudWatch(correlationId),
      this.checkS3Access(correlationId),
    ];

    const results = await Promise.allSettled(healthChecks);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        dependencies.push(result.value);
      } else {
        const serviceName = ['DynamoDB', 'CloudWatch', 'S3'][index];
        dependencies.push({
          service: serviceName,
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    // Calculate overall system health
    const summary = this.calculateHealthSummary(dependencies);
    const overallStatus = this.determineOverallStatus(summary);
    
    const systemHealth: SystemHealth = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: this.version,
      uptime: Date.now() - this.startTime,
      dependencies,
      summary,
    };

    // Record health metrics
    await this.recordHealthMetrics(systemHealth, correlationId);

    // Check for alerting conditions
    if (this.alertingConfig.enabled) {
      await this.checkAlertingConditions(systemHealth, correlationId);
    }

    this.logger.info('Health check completed', {
      correlationId,
      overallStatus,
      duration: Date.now() - startTime,
      summary,
    });

    return systemHealth;
  }

  /**
   * Check DynamoDB connectivity and performance
   */
  private async checkDynamoDB(correlationId: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity with a lightweight operation
      await this.dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: 'HEALTH_CHECK',
          SK: 'HEALTH_CHECK',
        },
      }));

      const responseTime = Date.now() - startTime;
      
      // Determine status based on response time
      let status: 'healthy' | 'degraded' = 'healthy';
      if (responseTime > 1000) {
        status = 'degraded';
      }

      return {
        service: 'DynamoDB',
        status,
        responseTime,
        details: {
          tableName: this.tableName,
          region: process.env.AWS_REGION,
        },
      };
    } catch (error) {
      return {
        service: 'DynamoDB',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        details: {
          tableName: this.tableName,
          region: process.env.AWS_REGION,
        },
      };
    }
  }

  /**
   * Check CloudWatch connectivity
   */
  private async checkCloudWatch(correlationId: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Test CloudWatch by sending a test metric
      await this.cloudWatchClient.send(new PutMetricDataCommand({
        Namespace: 'ModelRegistry/HealthCheck',
        MetricData: [{
          MetricName: 'HealthCheckTest',
          Value: 1,
          Unit: 'Count',
          Timestamp: new Date(),
        }],
      }));

      const responseTime = Date.now() - startTime;
      
      let status: 'healthy' | 'degraded' = 'healthy';
      if (responseTime > 2000) {
        status = 'degraded';
      }

      return {
        service: 'CloudWatch',
        status,
        responseTime,
        details: {
          region: process.env.AWS_REGION,
        },
      };
    } catch (error) {
      return {
        service: 'CloudWatch',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        details: {
          region: process.env.AWS_REGION,
        },
      };
    }
  }

  /**
   * Check S3 access (if S3 bucket is configured)
   */
  private async checkS3Access(correlationId: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const testBucket = process.env.HEALTH_CHECK_S3_BUCKET;
    
    if (!testBucket) {
      return {
        service: 'S3',
        status: 'healthy',
        responseTime: 0,
        details: {
          note: 'S3 health check skipped - no test bucket configured',
        },
      };
    }

    try {
      await this.s3Client.send(new HeadBucketCommand({
        Bucket: testBucket,
      }));

      const responseTime = Date.now() - startTime;
      
      let status: 'healthy' | 'degraded' = 'healthy';
      if (responseTime > 2000) {
        status = 'degraded';
      }

      return {
        service: 'S3',
        status,
        responseTime,
        details: {
          bucket: testBucket,
          region: process.env.AWS_REGION,
        },
      };
    } catch (error) {
      return {
        service: 'S3',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        details: {
          bucket: testBucket,
          region: process.env.AWS_REGION,
        },
      };
    }
  }

  /**
   * Calculate health summary statistics
   */
  private calculateHealthSummary(dependencies: HealthCheckResult[]): SystemHealth['summary'] {
    const summary = {
      healthy: 0,
      unhealthy: 0,
      degraded: 0,
      total: dependencies.length,
    };

    dependencies.forEach(dep => {
      switch (dep.status) {
        case 'healthy':
          summary.healthy++;
          break;
        case 'unhealthy':
          summary.unhealthy++;
          break;
        case 'degraded':
          summary.degraded++;
          break;
      }
    });

    return summary;
  }

  /**
   * Determine overall system status
   */
  private determineOverallStatus(summary: SystemHealth['summary']): 'healthy' | 'unhealthy' | 'degraded' {
    if (summary.unhealthy > 0) {
      return 'unhealthy';
    }
    if (summary.degraded > 0) {
      return 'degraded';
    }
    return 'healthy';
  }

  /**
   * Record health metrics to CloudWatch
   */
  private async recordHealthMetrics(health: SystemHealth, correlationId: string): Promise<void> {
    try {
      // Record overall health
      await this.metricsService.recordHealthCheck(
        health.status === 'healthy',
        health.dependencies.reduce((acc, dep) => {
          acc[dep.service.toLowerCase()] = dep.status === 'healthy';
          return acc;
        }, {} as Record<string, boolean>),
        correlationId
      );

      // Record detailed metrics for each dependency
      for (const dep of health.dependencies) {
        await this.metricsService.emitMetric({
          metricName: 'DependencyResponseTime',
          value: dep.responseTime,
          unit: 'Milliseconds',
          dimensions: {
            Service: dep.service,
            Status: dep.status,
          },
        }, correlationId);
      }

      // Record uptime
      await this.metricsService.emitMetric({
        metricName: 'ServiceUptime',
        value: health.uptime,
        unit: 'Milliseconds',
      }, correlationId);

    } catch (error) {
      this.logger.warn('Failed to record health metrics', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check alerting conditions and trigger alerts if necessary
   */
  private async checkAlertingConditions(health: SystemHealth, correlationId: string): Promise<void> {
    const criticalIssues: string[] = [];

    // Check for unhealthy dependencies
    const unhealthyDeps = health.dependencies.filter(dep => dep.status === 'unhealthy');
    if (unhealthyDeps.length > 0) {
      criticalIssues.push(`Unhealthy dependencies: ${unhealthyDeps.map(d => d.service).join(', ')}`);
    }

    // Check for slow response times
    const slowDeps = health.dependencies.filter(dep => 
      dep.responseTime > this.alertingConfig.thresholds.responseTime
    );
    if (slowDeps.length > 0) {
      criticalIssues.push(`Slow dependencies: ${slowDeps.map(d => `${d.service} (${d.responseTime}ms)`).join(', ')}`);
    }

    if (criticalIssues.length > 0) {
      await this.triggerAlert(health, criticalIssues, correlationId);
    }
  }

  /**
   * Trigger alert for critical health issues
   */
  private async triggerAlert(health: SystemHealth, issues: string[], correlationId: string): Promise<void> {
    this.logger.error('Health check alert triggered', {
      correlationId,
      overallStatus: health.status,
      issues,
      timestamp: health.timestamp,
    });

    // Emit alert metric
    await this.metricsService.emitMetric({
      metricName: 'HealthAlert',
      value: 1,
      unit: 'Count',
      dimensions: {
        Severity: health.status === 'unhealthy' ? 'Critical' : 'Warning',
        IssueCount: issues.length.toString(),
      },
    }, correlationId);

    // TODO: Integrate with SNS or other alerting mechanism
    // This could send notifications to operations teams
  }

  /**
   * Get simple health status for load balancer health checks
   */
  async getSimpleHealthStatus(correlationId: string): Promise<{ status: 'healthy' | 'unhealthy'; timestamp: string }> {
    try {
      // Quick DynamoDB connectivity check
      const startTime = Date.now();
      await this.dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: 'HEALTH_CHECK',
          SK: 'HEALTH_CHECK',
        },
      }));

      const responseTime = Date.now() - startTime;
      const status = responseTime < 5000 ? 'healthy' : 'unhealthy';

      return {
        status,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn('Simple health check failed', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      };
    }
  }
}