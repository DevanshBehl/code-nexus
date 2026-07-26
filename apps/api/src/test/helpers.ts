import type { Express } from 'express';
import { loadConfig } from '@code-nexus/config';
import { createLogger } from '@code-nexus/logger';
import { InMemorySessionStore } from '@code-nexus/auth';
import type { Publisher } from '@code-nexus/mq';
import type { ExecutionJob } from '@code-nexus/types';
import { createApp } from '../app.js';
import type { RoomBus } from '../deps.js';
import type { RecordingStorage } from '../modules/recordings/recordings.storage.js';

/** A recording fake publisher — lets arena tests assert jobs were enqueued. */
export function fakePublisher(): Publisher & { jobs: ExecutionJob[] } {
  const jobs: ExecutionJob[] = [];
  return {
    jobs,
    async publishJob(job) {
      jobs.push(job);
    },
    async close() {},
  };
}

/** A recording fake room bus — lets webinar/interview tests assert fan-out events. */
export function fakeRoomBus(): RoomBus & {
  events: { channel: string; event: unknown }[];
} {
  const events: { channel: string; event: unknown }[] = [];
  return {
    events,
    async publish(channel, event) {
      events.push({ channel, event });
    },
  };
}

/** Build a test app backed by an in-memory session store (no Redis). */
export function buildTestApp(
  overrides: {
    publisher?: Publisher | null;
    roomBus?: RoomBus | null;
    recordingStorage?: RecordingStorage | null;
  } = {},
): {
  app: Express;
  store: InMemorySessionStore;
} {
  const config = loadConfig({
    source: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_COOKIE_SECRET: 'test-cookie-secret-at-least-16-chars',
      BCRYPT_COST: '6', // fast for tests
      PASSWORD_MIN_LENGTH: '12',
    },
  });
  const logger = createLogger({ level: 'fatal', name: 'test' });
  const store = new InMemorySessionStore({
    absoluteTtlSeconds: config.SESSION_ABSOLUTE_TTL_SECONDS,
    idleTtlSeconds: config.SESSION_IDLE_TTL_SECONDS,
  });
  const app = createApp({
    logger,
    config,
    sessionStore: store,
    publisher: overrides.publisher !== undefined ? overrides.publisher : null,
    roomBus: overrides.roomBus !== undefined ? overrides.roomBus : null,
    recordingStorage: overrides.recordingStorage !== undefined ? overrides.recordingStorage : null,
  });
  return { app, store };
}

/**
 * Extract cookies from a supertest response into a Cookie header string, and
 * pull the CSRF token so mutations can echo it.
 */
export function jar(setCookie: string[] | undefined) {
  const cookies = setCookie ?? [];
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
  const csrfMatch = cookieHeader.match(/cn_csrf=([^;]+)/);
  return { cookieHeader, csrf: csrfMatch?.[1] };
}
