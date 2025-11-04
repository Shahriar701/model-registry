export class Logger {
  private readonly logLevel: string;

  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'INFO';
  }

  info(message: string, meta: Record<string, any> = {}): void {
    if (this.shouldLog('INFO')) {
      this.log('INFO', message, meta);
    }
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    if (this.shouldLog('WARN')) {
      this.log('WARN', message, meta);
    }
  }

  error(message: string, meta: Record<string, any> = {}): void {
    if (this.shouldLog('ERROR')) {
      this.log('ERROR', message, meta);
    }
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    if (this.shouldLog('DEBUG')) {
      this.log('DEBUG', message, meta);
    }
  }

  private log(level: string, message: string, meta: Record<string, any>): void {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: 'model-registry',
      ...meta,
    };

    console.log(JSON.stringify(logEntry));
  }

  private shouldLog(level: string): boolean {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const requestedLevelIndex = levels.indexOf(level);

    return requestedLevelIndex >= currentLevelIndex;
  }
}