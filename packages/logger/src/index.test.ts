import { describe, expect, it } from 'vitest';
import { createLogger, withRequestId } from './index.js';

describe('logger', () => {
  it('creates a logger at the requested level', () => {
    const log = createLogger({ level: 'debug', name: 'test' });
    expect(log.level).toBe('debug');
  });

  it('derives a request-scoped child logger', () => {
    const log = createLogger({ name: 'test' });
    const child = withRequestId(log, 'req-123');
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });
});
