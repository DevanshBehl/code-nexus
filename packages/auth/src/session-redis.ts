import type { Redis } from 'ioredis';
import {
  generateSessionId,
  isSessionExpired,
  type SessionData,
  type SessionStore,
  type SessionTtl,
} from './session.js';

const sessionKey = (id: string) => `sess:${id}`;
const userIndexKey = (userId: string) => `usess:${userId}`;

/**
 * Redis-backed session store. Sessions expire via Redis TTL (absolute cap) and
 * an explicit idle check on read. A per-user index set enables logout-all.
 */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttl: SessionTtl,
  ) {}

  async create(
    data: Omit<SessionData, 'createdAt' | 'lastSeenAt'>,
  ): Promise<{ id: string; data: SessionData }> {
    const now = Date.now();
    const full: SessionData = { ...data, createdAt: now, lastSeenAt: now };
    const id = generateSessionId();
    await this.redis
      .multi()
      .set(sessionKey(id), JSON.stringify(full), 'EX', this.ttl.absoluteTtlSeconds)
      .sadd(userIndexKey(full.userId), id)
      .expire(userIndexKey(full.userId), this.ttl.absoluteTtlSeconds)
      .exec();
    return { id, data: full };
  }

  async get(id: string): Promise<SessionData | null> {
    const raw = await this.redis.get(sessionKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (isSessionExpired(data, this.ttl)) {
      await this.delete(id);
      return null;
    }
    return data;
  }

  async touch(id: string, lastSeenAt: number): Promise<void> {
    const raw = await this.redis.get(sessionKey(id));
    if (!raw) return;
    const data = JSON.parse(raw) as SessionData;
    data.lastSeenAt = lastSeenAt;
    // Preserve the remaining absolute TTL rather than resetting it.
    const remaining = await this.redis.ttl(sessionKey(id));
    const ex = remaining > 0 ? remaining : this.ttl.absoluteTtlSeconds;
    await this.redis.set(sessionKey(id), JSON.stringify(data), 'EX', ex);
  }

  async delete(id: string): Promise<void> {
    const raw = await this.redis.get(sessionKey(id));
    if (raw) {
      const data = JSON.parse(raw) as SessionData;
      await this.redis.srem(userIndexKey(data.userId), id);
    }
    await this.redis.del(sessionKey(id));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    const ids = await this.redis.smembers(userIndexKey(userId));
    const pipeline = this.redis.multi();
    for (const id of ids) pipeline.del(sessionKey(id));
    pipeline.del(userIndexKey(userId));
    await pipeline.exec();
  }
}
