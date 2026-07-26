import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

const validSource = {
  NODE_ENV: 'test',
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_COOKIE_SECRET: 'test-cookie-secret-at-least-16',
};

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const cfg = loadConfig({ source: validSource });
    expect(cfg.API_PORT).toBe(4000);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.NODE_ENV).toBe('test');
    expect(cfg.SESSION_ABSOLUTE_TTL_SECONDS).toBe(604800);
    expect(cfg.BCRYPT_COST).toBe(12);
  });

  it('fails fast with a readable error when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...withoutDb } = validSource;
    expect(() => loadConfig({ source: withoutDb })).toThrowError(/DATABASE_URL/);
  });

  it('fails fast when SESSION_COOKIE_SECRET is missing', () => {
    const { SESSION_COOKIE_SECRET: _omit, ...withoutSecret } = validSource;
    expect(() => loadConfig({ source: withoutSecret })).toThrowError(/SESSION_COOKIE_SECRET/);
  });
});
