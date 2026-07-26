import { afterAll, describe, expect, it } from 'vitest';
import * as amqp from 'amqplib';
import type { ExecutionJob } from '@code-nexus/types';
import { createBroker, consumeJobs, type ConsumerHandle, type Publisher } from './index.js';

const URL = process.env.RABBITMQ_URL ?? 'amqp://codenexus:codenexus_dev_pw@localhost:5672';

async function brokerAvailable(): Promise<boolean> {
  try {
    const c = await amqp.connect(URL);
    await c.close();
    return true;
  } catch {
    return false;
  }
}
const READY = await brokerAvailable();

describe.skipIf(!READY)('@code-nexus/mq roundtrip', () => {
  const openHandles: (Publisher | ConsumerHandle)[] = [];
  afterAll(async () => {
    for (const h of openHandles) await h.close().catch(() => undefined);
  });

  it('publishes a job and the consumer receives it', async () => {
    const queue = `test.arena.${Date.now()}`;
    const received: ExecutionJob[] = [];

    const got = new Promise<void>((resolve) => {
      void consumeJobs(
        URL,
        queue,
        async (job) => {
          received.push(job);
          resolve();
        },
        { prefetch: 1 },
      ).then((h) => openHandles.push(h));
    });

    const broker = await createBroker(URL, queue);
    openHandles.push(broker);
    await broker.publishJob({ submissionPublicId: 'sub-123' });

    await Promise.race([
      got,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);

    expect(received).toHaveLength(1);
    expect(received[0]!.submissionPublicId).toBe('sub-123');
  });
});
