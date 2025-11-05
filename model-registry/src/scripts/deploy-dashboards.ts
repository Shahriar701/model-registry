#!/usr/bin/env node

/**
 * Script to deploy CloudWatch dashboards for Model Registry monitoring
 * 
 * Usage:
 *   npm run deploy-dashboards
 *   node dist/scripts/deploy-dashboards.js
 */

import { DashboardService } from '../monitoring/dashboard-service';
import { Logger } from '../utils/logger';

const logger = new Logger();

async function main() {
  const correlationId = `deploy-dashboards-${Date.now()}`;
  
  logger.info('Starting dashboard deployment', { correlationId });

  try {
    const dashboardService = new DashboardService();
    
    // Deploy all standard dashboards
    await dashboardService.deployStandardDashboards(correlationId);
    
    logger.info('Dashboard deployment completed successfully', { correlationId });
    
    console.log('\n✅ Dashboard deployment completed successfully!');
    console.log('\nDeployed dashboards:');
    console.log('  - ModelRegistry-Operational: Operational metrics and system health');
    console.log('  - ModelRegistry-Business: Business metrics and usage statistics');
    console.log('  - ModelRegistry-Errors: Error analysis and troubleshooting');
    console.log('\nYou can view these dashboards in the AWS CloudWatch console.');
    
  } catch (error) {
    logger.error('Dashboard deployment failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    console.error('\n❌ Dashboard deployment failed:');
    console.error(error instanceof Error ? error.message : String(error));
    
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main();
}