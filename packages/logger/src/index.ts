import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  /** Service name attached to every log line (e.g. "api"). */
  name?: string;
  /** Pretty-print for local dev; JSON otherwise. */
  pretty?: boolean;
}

/**
 * Create the root logger for a service. Structured JSON by default so logs are
 * machine-parseable across the future distributed services.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { level = 'info', name, pretty = false } = options;

  const base: LoggerOptions = {
    level,
    ...(name ? { name } : {}),
    // Redact common secret-bearing fields defensively.
    redact: {
      paths: ['req.headers.authorization', 'password', '*.password', 'passwordHash'],
      remove: true,
    },
  };

  if (pretty) {
    return pino({
      ...base,
      transport: {
        target: 'pino/file',
        options: { destination: 1 },
      },
    });
  }

  return pino(base);
}

/**
 * Derive a request-scoped child logger carrying the correlation id, so every
 * log line for a request is traceable end-to-end.
 */
export function withRequestId(logger: Logger, requestId: string): Logger {
  return logger.child({ requestId });
}
