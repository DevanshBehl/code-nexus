import { describe, expect, it } from 'vitest';
import { InMemorySessionStore } from './session-memory.js';
import type { SessionData } from './session.js';

const base: Omit<SessionData, 'createdAt' | 'lastSeenAt'> = {
  userId: 'user-1',
  publicId: 'pub-1',
  role: 'ADMIN',
  status: 'ACTIVE',
};

describe('InMemorySessionStore', () => {
  it('creates and reads a session', async () => {
    const store = new InMemorySessionStore({ absoluteTtlSeconds: 100, idleTtlSeconds: 100 });
    const { id } = await store.create(base);
    const data = await store.get(id);
    expect(data?.userId).toBe('user-1');
  });

  it('deletes a session', async () => {
    const store = new InMemorySessionStore({ absoluteTtlSeconds: 100, idleTtlSeconds: 100 });
    const { id } = await store.create(base);
    await store.delete(id);
    expect(await store.get(id)).toBeNull();
  });

  it('evicts idle-expired sessions on read', async () => {
    const store = new InMemorySessionStore({ absoluteTtlSeconds: 1000, idleTtlSeconds: 0 });
    const { id } = await store.create(base);
    // idleTtl 0 → any elapsed time counts as idle-expired
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.get(id)).toBeNull();
  });

  it('logout-all removes every session for a user', async () => {
    const store = new InMemorySessionStore({ absoluteTtlSeconds: 100, idleTtlSeconds: 100 });
    const a = await store.create(base);
    const b = await store.create(base);
    await store.deleteAllForUser('user-1');
    expect(await store.get(a.id)).toBeNull();
    expect(await store.get(b.id)).toBeNull();
  });
});
