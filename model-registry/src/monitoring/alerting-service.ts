import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Logger } from '../utils/logger';
import { SystemHealth } from './health-service';

export interface AlertConfig {
  enabled: boolean;
  snsTopicArn?: string;
  webhookUrl?: string;
  emailRecipients?: string[];
  slackWebhookUrl?: string;
}

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  timestamp: string;
  correlationId: string;
  metadata?: Record<string, any>;
}

export interface AlertRule {
  name: string;
  condition: (health: SystemHealth) => boolean;
  severity: 'critical' | 'warning' | 'info';
  message: (health: SystemHealth) => string;
  cooldownMinutes: number;
}

export class AlertingService {
  private readonly snsClient: SNSClient;
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly logger: Logger;
  private readonly config: AlertConfig;
  private readonly alertRules: AlertRule[];
  private readonly alertCooldowns: Map<string, number> = new Map();

  constructor() {
    this.snsClient = new SNSClient({});
    this.cloudWatchClient = new CloudWatchClient({});
    this.logger = new Logger();
    
    this.config = {
      enabled: process.env.ALERTING_ENABLED === 'true',
      snsTopicArn: process.env.ALERT_SNS_TOPIC_ARN,
      webhookUrl: process.env.ALERT_WEBHOOK_URL,
      emailRecipients: process.env.ALERT_EMAIL_RECIPIENTS?.split(','),
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    };

    this.alertRules = this.initializeAlertRules();
  }

  /**
   * Initialize default alert rules
   */
  private initializeAlertRules(): AlertRule[] {
    return [
      {
        name: 'SystemUnhealthy',
        condition: (health) => health.status === 'unhealthy',
        severity: 'critical',
        message: (health) => 
          `Model Registry system is unhealthy. ${health.summary.unhealthy} out of ${health.summary.total} dependencies are failing.`,
        cooldownMinutes: 5,
      },
      {
        name: 'SystemDegraded',
        condition: (health) => health.status === 'degraded',
        severity: 'warning',
        message: (health) => 
          `Model Registry system is degraded. ${health.summary.degraded} out of ${health.summary.total} dependencies are slow.`,
        cooldownMinutes: 10,
      },
      {
        name: 'DynamoDBUnhealthy',
        condition: (health) => 
          health.dependencies.some(dep => dep.service === 'DynamoDB' && dep.status === 'unhealthy'),
        severity: 'critical',
        message: (health) => {
          const dynamo = health.dependencies.find(dep => dep.service === 'DynamoDB');
          return `DynamoDB is unhealthy: ${dynamo?.error || 'Unknown error'}`;
        },
        cooldownMinutes: 3,
      },
      {
        name: 'HighResponseTime',
        condition: (health) => 
          health.dependencies.some(dep => dep.responseTime > 5000),
        severity: 'warning',
        message: (health) => {
          const slowDeps = health.dependencies.filter(dep => dep.responseTime > 5000);
          return `High response times detected: ${slowDeps.map(d => `${d.service} (${d.responseTime}ms)`).join(', ')}`;
        },
        cooldownMinutes: 15,
      },
      {
        name: 'MultipleServiceFailures',
        condition: (health) => health.summary.unhealthy >= 2,
        severity: 'critical',
        message: (health) => {
          const unhealthy = health.dependencies.filter(dep => dep.status === 'unhealthy');
          return `Multiple service failures detected: ${unhealthy.map(d => d.service).join(', ')}`;
        },
        cooldownMinutes: 5,
      },
    ];
  }

  /**
   * Process health check results and trigger alerts if necessary
   */
  async processHealthCheck(health: SystemHealth, correlationId: string): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('Alerting is disabled', { correlationId });
      return;
    }

    const triggeredAlerts: Alert[] = [];

    for (const rule of this.alertRules) {
      if (this.shouldTriggerAlert(rule, health)) {
        const alert = this.createAlert(rule, health, correlationId);
        triggeredAlerts.push(alert);
        
        // Set cooldown for this rule
        this.alertCooldowns.set(rule.name, Date.now() + (rule.cooldownMinutes * 60 * 1000));
      }
    }

    if (triggeredAlerts.length > 0) {
      await this.sendAlerts(triggeredAlerts, correlationId);
    }
  }

  /**
   * Check if an alert rule should be triggered
   */
  private shouldTriggerAlert(rule: AlertRule, health: SystemHealth): boolean {
    // Check if rule condition is met
    if (!rule.condition(health)) {
      return false;
    }

    // Check cooldown period
    const cooldownEnd = this.alertCooldowns.get(rule.name);
    if (cooldownEnd && Date.now() < cooldownEnd) {
      this.logger.debug('Alert rule in cooldown period', {
        ruleName: rule.name,
        cooldownEnd: new Date(cooldownEnd).toISOString(),
      });
      return false;
    }

    return true;
  }

  /**
   * Create an alert from a triggered rule
   */
  private createAlert(rule: AlertRule, health: SystemHealth, correlationId: string): Alert {
    return {
      id: `${rule.name}-${Date.now()}`,
      severity: rule.severity,
      title: `Model Registry Alert: ${rule.name}`,
      description: rule.message(health),
      timestamp: new Date().toISOString(),
      correlationId,
      metadata: {
        ruleName: rule.name,
        systemStatus: health.status,
        dependencies: health.dependencies.map(dep => ({
          service: dep.service,
          status: dep.status,
          responseTime: dep.responseTime,
        })),
        summary: health.summary,
      },
    };
  }

  /**
   * Send alerts through configured channels
   */
  private async sendAlerts(alerts: Alert[], correlationId: string): Promise<void> {
    this.logger.info('Sending alerts', {
      correlationId,
      alertCount: alerts.length,
      severities: alerts.map(a => a.severity),
    });

    const sendPromises: Promise<void>[] = [];

    for (const alert of alerts) {
      // Send to SNS if configured
      if (this.config.snsTopicArn) {
        sendPromises.push(this.sendSNSAlert(alert));
      }

      // Send to webhook if configured
      if (this.config.webhookUrl) {
        sendPromises.push(this.sendWebhookAlert(alert));
      }

      // Send to Slack if configured
      if (this.config.slackWebhookUrl) {
        sendPromises.push(this.sendSlackAlert(alert));
      }

      // Record alert metric
      sendPromises.push(this.recordAlertMetric(alert, correlationId));
    }

    // Wait for all alerts to be sent
    const results = await Promise.allSettled(sendPromises);
    
    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error('Failed to send alert', {
          correlationId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  }

  /**
   * Send alert via SNS
   */
  private async sendSNSAlert(alert: Alert): Promise<void> {
    if (!this.config.snsTopicArn) return;

    try {
      const message = {
        alertId: alert.id,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        timestamp: alert.timestamp,
        service: 'ModelRegistry',
        correlationId: alert.correlationId,
        metadata: alert.metadata,
      };

      await this.snsClient.send(new PublishCommand({
        TopicArn: this.config.snsTopicArn,
        Subject: alert.title,
        Message: JSON.stringify(message, null, 2),
        MessageAttributes: {
          severity: {
            DataType: 'String',
            StringValue: alert.severity,
          },
          service: {
            DataType: 'String',
            StringValue: 'ModelRegistry',
          },
        },
      }));

      this.logger.info('SNS alert sent successfully', {
        alertId: alert.id,
        severity: alert.severity,
      });
    } catch (error) {
      this.logger.error('Failed to send SNS alert', {
        alertId: alert.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Send alert via webhook
   */
  private async sendWebhookAlert(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) return;

    try {
      const payload = {
        alertId: alert.id,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        timestamp: alert.timestamp,
        service: 'ModelRegistry',
        correlationId: alert.correlationId,
        metadata: alert.metadata,
      };

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      this.logger.info('Webhook alert sent successfully', {
        alertId: alert.id,
        severity: alert.severity,
      });
    } catch (error) {
      this.logger.error('Failed to send webhook alert', {
        alertId: alert.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Send alert to Slack
   */
  private async sendSlackAlert(alert: Alert): Promise<void> {
    if (!this.config.slackWebhookUrl) return;

    try {
      const color = alert.severity === 'critical' ? 'danger' : 
                   alert.severity === 'warning' ? 'warning' : 'good';

      const payload = {
        text: alert.title,
        attachments: [{
          color,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Service',
              value: 'Model Registry',
              short: true,
            },
            {
              title: 'Timestamp',
              value: alert.timestamp,
              short: true,
            },
            {
              title: 'Correlation ID',
              value: alert.correlationId,
              short: true,
            },
            {
              title: 'Description',
              value: alert.description,
              short: false,
            },
          ],
        }],
      };

      const response = await fetch(this.config.slackWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook returned ${response.status}: ${response.statusText}`);
      }

      this.logger.info('Slack alert sent successfully', {
        alertId: alert.id,
        severity: alert.severity,
      });
    } catch (error) {
      this.logger.error('Failed to send Slack alert', {
        alertId: alert.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Record alert metric in CloudWatch
   */
  private async recordAlertMetric(alert: Alert, correlationId: string): Promise<void> {
    try {
      await this.cloudWatchClient.send(new PutMetricDataCommand({
        Namespace: 'ModelRegistry/Alerts',
        MetricData: [{
          MetricName: 'AlertTriggered',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            {
              Name: 'Severity',
              Value: alert.severity,
            },
            {
              Name: 'RuleName',
              Value: alert.metadata?.ruleName || 'Unknown',
            },
          ],
          Timestamp: new Date(),
        }],
      }));
    } catch (error) {
      this.logger.warn('Failed to record alert metric', {
        correlationId,
        alertId: alert.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Manually trigger a test alert
   */
  async sendTestAlert(correlationId: string): Promise<void> {
    const testAlert: Alert = {
      id: `test-${Date.now()}`,
      severity: 'info',
      title: 'Model Registry Test Alert',
      description: 'This is a test alert to verify the alerting system is working correctly.',
      timestamp: new Date().toISOString(),
      correlationId,
      metadata: {
        test: true,
      },
    };

    await this.sendAlerts([testAlert], correlationId);
  }
}