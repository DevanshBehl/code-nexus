import * as amqp from 'amqplib';
import type { ExecutionJob } from '@code-nexus/types';

/**
 * @code-nexus/mq — thin, typed RabbitMQ wrappers for the Code Arena execution
 * pipeline (Phase 6). The api uses `createBroker(...).publishJob()`; the
 * execution-worker uses `consumeJobs(...)`. Messages are persistent; the work
 * queue is durable with a dead-letter queue for poison messages.
 */

const DLQ_SUFFIX = '.dlq';

/** Assert the durable work queue (+ its dead-letter queue) idempotently. */
async function assertQueues(ch: amqp.Channel, queue: string): Promise<void> {
  const dlq = `${queue}${DLQ_SUFFIX}`;
  await ch.assertQueue(dlq, { durable: true });
  await ch.assertQueue(queue, {
    durable: true,
    deadLetterExchange: '', // default exchange
    deadLetterRoutingKey: dlq,
  });
}

export interface Publisher {
  /** Enqueue an execution job (persistent). */
  publishJob(job: ExecutionJob): Promise<void>;
  close(): Promise<void>;
}

/** Connect a publisher to the work queue. */
export async function createBroker(url: string, queue: string): Promise<Publisher> {
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await assertQueues(ch, queue);

  return {
    async publishJob(job: ExecutionJob): Promise<void> {
      ch.sendToQueue(queue, Buffer.from(JSON.stringify(job)), { persistent: true });
    },
    async close(): Promise<void> {
      await ch.close().catch(() => undefined);
      await conn.close().catch(() => undefined);
    },
  };
}

export interface ConsumerHandle {
  close(): Promise<void>;
}

export interface ConsumeOptions {
  prefetch?: number;
}

/**
 * Consume execution jobs. The handler runs per message; on success the message
 * is acked. On a thrown error the message is retried once (requeue) and then
 * dead-lettered — so a poison message can never spin forever. The handler itself
 * should be idempotent (RabbitMQ is at-least-once).
 */
export async function consumeJobs(
  url: string,
  queue: string,
  handler: (job: ExecutionJob) => Promise<void>,
  options: ConsumeOptions = {},
): Promise<ConsumerHandle> {
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await assertQueues(ch, queue);
  await ch.prefetch(options.prefetch ?? 1);

  await ch.consume(queue, (msg) => {
    if (!msg) return;
    void (async () => {
      try {
        const job = JSON.parse(msg.content.toString()) as ExecutionJob;
        await handler(job);
        ch.ack(msg);
      } catch {
        // First failure → requeue once; a redelivered failure → dead-letter it.
        ch.nack(msg, false, !msg.fields.redelivered);
      }
    })();
  });

  return {
    async close(): Promise<void> {
      await ch.close().catch(() => undefined);
      await conn.close().catch(() => undefined);
    },
  };
}
