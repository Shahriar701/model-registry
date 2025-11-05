import { MetricsService } from './metrics-service';
import { Logger } from '../utils/logger';

export interface PerformanceContext {
  operation: string;
  startTime: number;
  correlationId: string;
  dimensions?: Record<string, string>;
}

export class PerformanceMonitor {
  private readonly metricsService: MetricsService;
  private readonly logger: Logger;

  constructor(metricsService: MetricsService) {
    this.metricsService = metricsService;
    this.logger = new Logger();
  }

  /**
   * Start timing an operation
   */
  startOperation(operation: string, correlationId: string, dimensions?: Record<string, string>): PerformanceContext {
    const context: PerformanceContext = {
      operation,
      startTime: Date.now(),
      correlationId,
      dimensions,
    };

    this.logger.debug('Started operation timing', {
      correlationId,
      operation,
      dimensions,
    });

    return context;
  }

  /**
   * End timing an operation and record metrics
   */
  async endOperation(context: PerformanceContext, success: boolean = true): Promise<number> {
    const duration = Date.now() - context.startTime;

    this.logger.debug('Completed operation timing', {
      correlationId: context.correlationId,
      operation: context.operation,
      duration,
      success,
      dimensions: context.dimensions,
    });

    // Record latency metric
    await this.metricsService.recordLatency(
      {
        operation: context.operation,
        duration,
        success,
        dimensions: context.dimensions,
      },
      context.correlationId
    );

    return duration;
  }

  /**
   * Wrap an async function with performance monitoring
   */
  async wrapAsync<T>(
    operation: string,
    correlationId: string,
    fn: () => Promise<T>,
    dimensions?: Record<string, string>
  ): Promise<T> {
    const context = this.startOperation(operation, correlationId, dimensions);
    let success = true;
    
    try {
      const result = await fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      await this.endOperation(context, success);
    }
  }

  /**
   * Wrap a synchronous function with performance monitoring
   */
  async wrapSync<T>(
    operation: string,
    correlationId: string,
    fn: () => T,
    dimensions?: Record<string, string>
  ): Promise<T> {
    const context = this.startOperation(operation, correlationId, dimensions);
    let success = true;
    
    try {
      const result = fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      await this.endOperation(context, success);
    }
  }

  /**
   * Record database operation performance
   */
  async recordDatabaseOperation<T>(
    operation: string,
    correlationId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let success = true;

    try {
      const result = await fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      await this.metricsService.recordDatabaseOperation(operation, duration, success, correlationId);
    }
  }
}