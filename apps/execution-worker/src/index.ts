import { loadConfig } from '@code-nexus/config';
import { createLogger } from '@code-nexus/logger';
import { prisma } from '@code-nexus/db';
import { consumeJobs, type ConsumerHandle } from '@code-nexus/mq';
import { createJudge0Client, type Judge0Client } from './judge0.js';
import { createPistonClient } from './piston.js';
import { createLocalClient } from './local.js';
import { handleJob } from './worker.js';

/**
 * The Code Nexus execution worker — a standalone process (NOT the API). It
 * consumes arena submission jobs from RabbitMQ and runs the untrusted code
 * inside Judge0. If it (or Judge0) is down, the API stays fully up; submissions
 * simply stay QUEUED until a worker is available (or are reaped to ERROR).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    level: config.LOG_LEVEL,
    name: 'execution-worker',
    pretty: config.NODE_ENV === 'development',
  });

  if (!config.RABBITMQ_URL) {
    logger.fatal('RABBITMQ_URL is required to run the execution worker');
    process.exit(1);
  }

  // Select the execution engine. Piston needs no key (PISTON_URL has a default);
  // Judge0 needs JUDGE0_URL. A missing/unconfigured engine fails jobs gracefully
  // (each submission is marked ERROR).
  let engine: Judge0Client;
  if (config.EXECUTION_ENGINE === 'local') {
    if (process.platform !== 'darwin') {
      logger.fatal('EXECUTION_ENGINE=local is macOS-only (uses sandbox-exec)');
      process.exit(1);
    }
    engine = createLocalClient(config);
    logger.warn(
      '⚠️  Using LOCAL execution engine — code runs on THIS machine under a macOS ' +
        'sandbox (sandbox-exec + ulimit + timeout). DEMO/DEV ONLY; never on a deployed server.',
    );
  } else if (config.EXECUTION_ENGINE === 'piston') {
    engine = createPistonClient(config);
    logger.info({ engine: 'piston', url: config.PISTON_URL }, 'Using Piston execution engine');
  } else if (config.JUDGE0_URL) {
    engine = createJudge0Client(config);
    logger.info({ engine: 'judge0', url: config.JUDGE0_URL }, 'Using Judge0 execution engine');
  } else {
    logger.warn('No execution engine configured — every submission will be marked ERROR');
    engine = { runBatch: () => Promise.reject(new Error('No execution engine configured')) };
  }

  const consumer: ConsumerHandle = await consumeJobs(
    config.RABBITMQ_URL,
    config.ARENA_QUEUE,
    (job) => handleJob(engine, job, logger),
    { prefetch: config.ARENA_WORKER_PREFETCH },
  );

  logger.info(
    { queue: config.ARENA_QUEUE, prefetch: config.ARENA_WORKER_PREFETCH },
    'Execution worker consuming jobs',
  );

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down worker');
    void Promise.allSettled([consumer.close(), prisma.$disconnect()]).finally(() =>
      process.exit(0),
    );
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal worker boot error:', err);
  process.exit(1);
});
