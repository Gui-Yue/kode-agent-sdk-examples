type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = 'info';

function ts(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, module: string, message: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const prefix = `[${ts()}] [${level.toUpperCase()}] [${module}]`;
  if (data !== undefined) {
    console[level === 'debug' ? 'log' : level](prefix, message, data);
  } else {
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
}

export const logger = {
  setLevel(level: LogLevel) { minLevel = level; },
  debug: (module: string, msg: string, data?: unknown) => log('debug', module, msg, data),
  info:  (module: string, msg: string, data?: unknown) => log('info', module, msg, data),
  warn:  (module: string, msg: string, data?: unknown) => log('warn', module, msg, data),
  error: (module: string, msg: string, data?: unknown) => log('error', module, msg, data),
};
