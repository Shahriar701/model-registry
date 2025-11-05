import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';
import { Logger } from '../utils/logger';

export interface MetricData {
  metricName: string;
  value: number;
  unit: 'Count' | 'Seconds' | 'Milliseconds' | 'Bytes' | 'Percent';
  dimensions?: Record<string, string>;
  timestamp?: Date;
}

export interface LatencyMetric {
  operation: string;
  duration: number;
  success: boolean;
  dimensions?: Record<string, string>;
}

export class MetricsService {
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly logger: Logger;
  private readonly namespace: string;

  constructor() {
    this.cloudWatchClient = new CloudWatchClient({});
    this.logger = new Logger();
    this.namespace = process.env.METRICS_NAMESPACE || 'ModelRegistry';
  }

  /**
   * Emit a single metric to CloudWatch
   */
  async emitMetric(metric: MetricData, correlationId: string): Promise<void> {
    try {
      const metricDatum: MetricDatum = {
        MetricName: metric.metricName,
        Value: metric.value,
        Unit: metric.unit,
        Timestamp: metric.timestamp || new Date(),
      };

      if (metric.dimensions) {
        metricDatum.Dimensions = Object.entries(metric.dimensions).map(([Name, Value]) => ({
          Name,
          Value,
        }));
      }

      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [metricDatum],
      });

      await this.cloudWatchClient.send(command);

      this.logger.debug('Metric emitted successfully', {
        correlationId,
        metricName: metric.metricName,
        value: metric.value,
        dimensions: metric.dimensions,
      });
    } catch (error) {
      this.logger.warn('Failed to emit metric', {
        correlationId,
        metricName: metric.metricName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Emit multiple metrics in a single batch
   */
  async emitMetrics(metrics: MetricData[], correlationId: string): Promise<void> {
    if (metrics.length === 0) return;

    try {
      const metricData: MetricDatum[] = metrics.map(metric => ({
        MetricName: metric.metricName,
        Value: metric.value,
        Unit: metric.unit,
        Timestamp: metric.timestamp || new Date(),
        Dimensions: metric.dimensions
          ? Object.entries(metric.dimensions).map(([Name, Value]) => ({ Name, Value }))
          : undefined,
      }));

      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData,
      });

      await this.cloudWatchClient.send(command);

      this.logger.debug('Batch metrics emitted successfully', {
        correlationId,
        metricCount: metrics.length,
        metricNames: metrics.map(m => m.metricName),
      });
    } catch (error) {
      this.logger.warn('Failed to emit batch metrics', {
        correlationId,
        metricCount: metrics.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record model registration metrics
   */
  async recordModelRegistration(
    teamId: string,
    framework: string,
    deploymentTarget: string,
    correlationId: string
  ): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'ModelRegistered',
        value: 1,
        unit: 'Count',
        dimensions: {
          TeamId: teamId,
          Framework: framework,
          DeploymentTarget: deploymentTarget,
        },
      },
      {
        metricName: 'ModelRegistrationsByTeam',
        value: 1,
        unit: 'Count',
        dimensions: {
          TeamId: teamId,
        },
      },
      {
        metricName: 'ModelRegistrationsByFramework',
        value: 1,
        unit: 'Count',
        dimensions: {
          Framework: framework,
        },
      },
      {
        metricName: 'ModelRegistrationsByDeploymentTarget',
        value: 1,
        unit: 'Count',
        dimensions: {
          DeploymentTarget: deploymentTarget,
        },
      },
    ];

    await this.emitMetrics(metrics, correlationId);
  }

  /**
   * Record model deregistration metrics
   */
  async recordModelDeregistration(teamId: string, correlationId: string): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'ModelDeregistered',
        value: 1,
        unit: 'Count',
        dimensions: {
          TeamId: teamId,
        },
      },
    ];

    await this.emitMetrics(metrics, correlationId);
  }

  /**
   * Record deployment trigger metrics
   */
  async recordDeploymentTrigger(
    teamId: string,
    deploymentTarget: string,
    correlationId: string
  ): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'DeploymentTriggered',
        value: 1,
        unit: 'Count',
        dimensions: {
          TeamId: teamId,
          DeploymentTarget: deploymentTarget,
        },
      },
    ];

    await this.emitMetrics(metrics, correlationId);
  }

  /**
   * Record API operation latency
   */
  async recordLatency(latencyMetric: LatencyMetric, correlationId: string): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'OperationLatency',
        value: latencyMetric.duration,
        unit: 'Milliseconds',
        dimensions: {
          Operation: latencyMetric.operation,
          Success: latencyMetric.success.toString(),
          ...latencyMetric.dimensions,
        },
      },
    ];

    await this.emitMetrics(metrics, correlationId);
  }

  /**
   * Record error metrics
   */
  async recordError(
    operation: string,
    errorType: string,
    statusCode: number,
    correlationId: string,
    dimensions?: Record<string, string>
  ): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'APIErrors',
        value: 1,
        unit: 'Count',
        dimensions: {
          Operation: operation,
          ErrorType: errorType,
          StatusCode: statusCode.toString(),
          ...dimensions,
        },
      },
      {
        metricName: 'ErrorRate',
        value: 1,
        unit: 'Count',
        dimensions: {
          Operation: operation,
          ...dimensions,
        },
      },
    ];

    await this.emitMetrics(metrics, correlationId);
  }

  /**
   * Record authentication metrics
   */
  async recordAuthentication(
    success: boolean,
    teamId?: string,
    correlationId?: string
  ): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'AuthenticationAttempts',
        value: 1,
        unit: 'Count',
        dimensions: {
          Success: success.toString(),
          ...(teamId && { TeamId: teamId }),
        },
      },
    ];

    if (!success) {
      metrics.push({
        metricName: 'AuthenticationFailures',
        value: 1,
        unit: 'Count',
      });
    }

    await this.emitMetrics(metrics, correlationId || 'no-correlation-id');
  }

  /**
   * Record database operation metrics
   */
  async recordDatabaseOperation(
    operation: string,
    duration: number,
    success: boolean,
    correlationId: string
  ): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'DatabaseOperationLatency',
        value: duration,
        unit: 'Milliseconds',
        dimensions: {
          Operation: operation,
          Success: success.toString(),
        },
      },
      {
        metricName: 'DatabaseOperations',
        value: 1,
        unit: 'Count',
        dimensions: {
          Operation: operation,
          Success: success.toString(),
        },
      },
    ];

    if (!success) {
      metrics.push({
        metricName: 'DatabaseErrors',
        value: 1,
        unit: 'Count',
        dimensions: {
          Operation: operation,
        },
      });
    }

    await this.emitMetrics(metrics, correlationId);
  }

  /**
   * Record health check metrics
   */
  async recordHealthCheck(
    overallHealth: boolean,
    dependencies: Record<string, boolean>,
    correlationId: string
  ): Promise<void> {
    const metrics: MetricData[] = [
      {
        metricName: 'HealthCheck',
        value: overallHealth ? 1 : 0,
        unit: 'Count',
      },
    ];

    // Add metrics for each dependency
    Object.entries(dependencies).forEach(([dependency, healthy]) => {
      metrics.push({
        metricName: 'DependencyHealth',
        value: healthy ? 1 : 0,
        unit: 'Count',
        dimensions: {
          Dependency: dependency,
        },
      });
    });

    await this.emitMetrics(metrics, correlationId);
  }

  /**
   * Record custom business metrics
   */
  async recordCustomMetric(
    metricName: string,
    value: number,
    unit: 'Count' | 'Seconds' | 'Milliseconds' | 'Bytes' | 'Percent',
    dimensions: Record<string, string>,
    correlationId: string
  ): Promise<void> {
    const metric: MetricData = {
      metricName,
      value,
      unit,
      dimensions,
    };

    await this.emitMetric(metric, correlationId);
  }
}