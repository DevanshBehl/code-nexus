import type { Server } from 'node:http';
import { Redis } from 'ioredis';
import { loadConfig } from '@code-nexus/config';
import { createLogger } from '@code-nexus/logger';
import { prisma } from '@code-nexus/db';
import { RedisSessionStore } from '@code-nexus/auth';
import { createBroker, type Publisher } from '@code-nexus/mq';
import { createApp } from './app.js';
import type { RoomBus } from './deps.js';
import { createRecordingStorage } from './modules/recordings/recordings.storage.js';

/**
 * Boot sequence (prompt_phase2.md §7):
 *   load & validate config -> logger -> connect Redis (fail fast) ->
 *   build session store -> create app -> listen -> graceful shutdown.
 */
async function main(): Promise<void> {
  const config = loadConfig(); // fails fast on invalid/missing env

  const logger = createLogger({
    level: config.LOG_LEVEL,
    name: 'api',
    pretty: config.NODE_ENV === 'development',
  });

  // Redis is required from Phase 2 — fail fast if it can't connect.
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  // Absorb connection errors so a failed connect surfaces as our clean fatal
  // (rather than an ioredis "unhandled error event").
  redis.on('error', (err) => logger.debug({ err }, 'redis error'));
  try {
    await redis.connect();
    await redis.ping();
  } catch (err) {
    logger.fatal({ err }, 'Cannot reach Redis — aborting boot');
    process.exit(1);
  }

  const sessionStore = new RedisSessionStore(redis, {
    absoluteTtlSeconds: config.SESSION_ABSOLUTE_TTL_SECONDS,
    idleTtlSeconds: config.SESSION_IDLE_TTL_SECONDS,
  });

  // Phase 6 — Code Arena job publisher. RabbitMQ is OPTIONAL for the API: if it's
  // unavailable the API still boots and serves everything; only arena run/submit
  // returns 503. The API never executes code — it only publishes jobs.
  let publisher: Publisher | null = null;
  if (config.RABBITMQ_URL) {
    try {
      publisher = await createBroker(config.RABBITMQ_URL, config.ARENA_QUEUE);
      logger.info({ queue: config.ARENA_QUEUE }, 'Arena job publisher connected');
    } catch (err) {
      logger.warn({ err }, 'RabbitMQ unavailable — arena run/submit will return 503');
    }
  } else {
    logger.warn('RABBITMQ_URL not set — arena run/submit will return 503');
  }

  // Phase 8/9 — real-time room fan-out. The api publishes host-originated events
  // (webinar poll opened/closed/ended, interview ended) to a Redis channel; the
  // ws-gateway relays them to the live room. `publish` is safe on the main
  // (non-subscriber) connection.
  const roomBus: RoomBus = {
    async publish(channel, event) {
      try {
        await redis.publish(channel, JSON.stringify(event));
      } catch (err) {
        logger.warn({ err }, 'Failed to publish room event — live fan-out skipped');
      }
    },
  };

  // Phase 10 — recording storage. Pluggable and infra-free by default (`local`
  // writes to disk); `null` here means uploads 503 while everything else — live
  // interviews included — keeps working.
  const recordingStorage = await createRecordingStorage(config, logger);

  const app = createApp({ logger, config, sessionStore, publisher, roomBus, recordingStorage });

  const server: Server = app.listen(config.API_PORT, () => {
    logger.info({ port: config.API_PORT, env: config.NODE_ENV }, 'Code Nexus API listening');
  });

  registerGracefulShutdown(server, logger, redis, publisher);
}

function registerGracefulShutdown(
  server: Server,
  logger: ReturnType<typeof createLogger>,
  redis: Redis,
  publisher: Publisher | null,
): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    server.close((err) => {
      if (err) logger.error({ err }, 'Error during HTTP server close');
      Promise.allSettled([prisma.$disconnect(), redis.quit(), publisher?.close()])
        .catch((e) => logger.error({ err: e }, 'Error during resource cleanup'))
        .finally(() => {
          logger.info('Shutdown complete');
          process.exit(err ? 1 : 0);
        });
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
