import {
  generateSessionId,
  isSessionExpired,
  type SessionData,
  type SessionStore,
  type SessionTtl,
} from './session.js';

/**
 * In-memory session store for tests. Same semantics as the Redis store:
 * evicts idle/expired sessions on read, supports logout-all.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionData>();

  constructor(private readonly ttl: SessionTtl) {}

  async create(
    data: Omit<SessionData, 'createdAt' | 'lastSeenAt'>,
  ): Promise<{ id: string; data: SessionData }> {
    const now = Date.now();
    const full: SessionData = { ...data, createdAt: now, lastSeenAt: now };
    const id = generateSessionId();
    this.sessions.set(id, full);
    return { id, data: full };
  }

  async get(id: string): Promise<SessionData | null> {
    const data = this.sessions.get(id);
    if (!data) return null;
    if (isSessionExpired(data, this.ttl)) {
      this.sessions.delete(id);
      return null;
    }
    return data;
  }

  async touch(id: string, lastSeenAt: number): Promise<void> {
    const data = this.sessions.get(id);
    if (data) data.lastSeenAt = lastSeenAt;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, data] of this.sessions) {
      if (data.userId === userId) this.sessions.delete(id);
    }
  }
}
