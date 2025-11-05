import { CloudWatchClient, PutDashboardCommand } from '@aws-sdk/client-cloudwatch';
import { Logger } from '../utils/logger';

export interface DashboardWidget {
  type: 'metric' | 'log' | 'number';
  x: number;
  y: number;
  width: number;
  height: number;
  properties: any;
}

export interface DashboardConfig {
  name: string;
  widgets: DashboardWidget[];
}

export class DashboardService {
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly logger: Logger;
  private readonly namespace: string;

  constructor() {
    this.cloudWatchClient = new CloudWatchClient({});
    this.logger = new Logger();
    this.namespace = process.env.METRICS_NAMESPACE || 'ModelRegistry';
  }

  /**
   * Create or update a CloudWatch dashboard
   */
  async createDashboard(config: DashboardConfig, correlationId: string): Promise<void> {
    try {
      const dashboardBody = {
        widgets: config.widgets,
      };

      const command = new PutDashboardCommand({
        DashboardName: config.name,
        DashboardBody: JSON.stringify(dashboardBody),
      });

      await this.cloudWatchClient.send(command);

      this.logger.info('Dashboard created/updated successfully', {
        correlationId,
        dashboardName: config.name,
        widgetCount: config.widgets.length,
      });
    } catch (error) {
      this.logger.error('Failed to create/update dashboard', {
        correlationId,
        dashboardName: config.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate operational dashboard configuration
   */
  generateOperationalDashboard(): DashboardConfig {
    return {
      name: 'ModelRegistry-Operational',
      widgets: [
        // API Request Rate
        {
          type: 'metric',
          x: 0,
          y: 0,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'ModelRegistered'],
              ['.', 'ModelDeregistered'],
              ['.', 'DeploymentTriggered'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'API Operations Rate',
            period: 300,
            stat: 'Sum',
          },
        },
        // Error Rate
        {
          type: 'metric',
          x: 12,
          y: 0,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'APIErrors'],
              ['.', 'AuthenticationFailures'],
              ['.', 'DatabaseErrors'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Error Rate',
            period: 300,
            stat: 'Sum',
          },
        },
        // Latency
        {
          type: 'metric',
          x: 0,
          y: 6,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'OperationLatency', 'Operation', 'RegisterModel'],
              ['.', '.', '.', 'ListModels'],
              ['.', '.', '.', 'GetModel'],
              ['.', '.', '.', 'TriggerDeployment'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Operation Latency (ms)',
            period: 300,
            stat: 'Average',
          },
        },
        // Database Performance
        {
          type: 'metric',
          x: 12,
          y: 6,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'DatabaseOperationLatency', 'Operation', 'PutItem'],
              ['.', '.', '.', 'GetItem'],
              ['.', '.', '.', 'Query'],
              ['.', '.', '.', 'Scan'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Database Operation Latency (ms)',
            period: 300,
            stat: 'Average',
          },
        },
        // Health Status
        {
          type: 'metric',
          x: 0,
          y: 12,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'HealthCheck'],
              ['.', 'DependencyHealth', 'Dependency', 'dynamodb'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'System Health',
            period: 300,
            stat: 'Average',
            yAxis: {
              left: {
                min: 0,
                max: 1,
              },
            },
          },
        },
        // Authentication Success Rate
        {
          type: 'metric',
          x: 12,
          y: 12,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'AuthenticationAttempts', 'Success', 'true'],
              ['.', '.', '.', 'false'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Authentication Success Rate',
            period: 300,
            stat: 'Sum',
          },
        },
      ],
    };
  }

  /**
   * Generate business metrics dashboard configuration
   */
  generateBusinessDashboard(): DashboardConfig {
    return {
      name: 'ModelRegistry-Business',
      widgets: [
        // Model Registrations by Team
        {
          type: 'metric',
          x: 0,
          y: 0,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'ModelRegistrationsByTeam'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Model Registrations by Team',
            period: 3600,
            stat: 'Sum',
          },
        },
        // Model Registrations by Framework
        {
          type: 'metric',
          x: 12,
          y: 0,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'ModelRegistrationsByFramework'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Model Registrations by Framework',
            period: 3600,
            stat: 'Sum',
          },
        },
        // Model Registrations by Deployment Target
        {
          type: 'metric',
          x: 0,
          y: 6,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'ModelRegistrationsByDeploymentTarget'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Model Registrations by Deployment Target',
            period: 3600,
            stat: 'Sum',
          },
        },
        // Deployment Activity
        {
          type: 'metric',
          x: 12,
          y: 6,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'DeploymentTriggered'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Deployment Activity',
            period: 3600,
            stat: 'Sum',
          },
        },
        // Total Models (Number Widget)
        {
          type: 'number',
          x: 0,
          y: 12,
          width: 6,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'ModelRegistered'],
            ],
            view: 'singleValue',
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Total Models Registered (24h)',
            period: 86400,
            stat: 'Sum',
          },
        },
        // Total Deployments (Number Widget)
        {
          type: 'number',
          x: 6,
          y: 12,
          width: 6,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'DeploymentTriggered'],
            ],
            view: 'singleValue',
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Total Deployments (24h)',
            period: 86400,
            stat: 'Sum',
          },
        },
        // Error Rate (Number Widget)
        {
          type: 'number',
          x: 12,
          y: 12,
          width: 6,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'APIErrors'],
            ],
            view: 'singleValue',
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'API Errors (24h)',
            period: 86400,
            stat: 'Sum',
          },
        },
        // Average Latency (Number Widget)
        {
          type: 'number',
          x: 18,
          y: 12,
          width: 6,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'OperationLatency'],
            ],
            view: 'singleValue',
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Average Latency (ms)',
            period: 3600,
            stat: 'Average',
          },
        },
      ],
    };
  }

  /**
   * Generate error analysis dashboard configuration
   */
  generateErrorDashboard(): DashboardConfig {
    return {
      name: 'ModelRegistry-Errors',
      widgets: [
        // Error Rate by Operation
        {
          type: 'metric',
          x: 0,
          y: 0,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'APIErrors', 'Operation', 'RegisterModel'],
              ['.', '.', '.', 'ListModels'],
              ['.', '.', '.', 'GetModel'],
              ['.', '.', '.', 'TriggerDeployment'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Error Rate by Operation',
            period: 300,
            stat: 'Sum',
          },
        },
        // Error Rate by Status Code
        {
          type: 'metric',
          x: 12,
          y: 0,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'APIErrors', 'StatusCode', '400'],
              ['.', '.', '.', '401'],
              ['.', '.', '.', '403'],
              ['.', '.', '.', '404'],
              ['.', '.', '.', '409'],
              ['.', '.', '.', '500'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Error Rate by Status Code',
            period: 300,
            stat: 'Sum',
          },
        },
        // Database Errors
        {
          type: 'metric',
          x: 0,
          y: 6,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'DatabaseErrors', 'Operation', 'PutItem'],
              ['.', '.', '.', 'GetItem'],
              ['.', '.', '.', 'Query'],
              ['.', '.', '.', 'Scan'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Database Errors by Operation',
            period: 300,
            stat: 'Sum',
          },
        },
        // Authentication Failures
        {
          type: 'metric',
          x: 12,
          y: 6,
          width: 12,
          height: 6,
          properties: {
            metrics: [
              [this.namespace, 'AuthenticationFailures'],
              ['.', 'AuthenticationAttempts', 'Success', 'false'],
            ],
            view: 'timeSeries',
            stacked: false,
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Authentication Failures',
            period: 300,
            stat: 'Sum',
          },
        },
      ],
    };
  }

  /**
   * Deploy all standard dashboards
   */
  async deployStandardDashboards(correlationId: string): Promise<void> {
    const dashboards = [
      this.generateOperationalDashboard(),
      this.generateBusinessDashboard(),
      this.generateErrorDashboard(),
    ];

    for (const dashboard of dashboards) {
      await this.createDashboard(dashboard, correlationId);
    }

    this.logger.info('All standard dashboards deployed successfully', {
      correlationId,
      dashboardCount: dashboards.length,
    });
  }
}