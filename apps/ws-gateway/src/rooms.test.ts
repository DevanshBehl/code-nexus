import { describe, expect, it } from 'vitest';
import { RateLimiter, RoomRegistry, parseInbound, type RoomConn } from './rooms.js';
import { tokenFromUrl } from './token.js';

function conn(id: string, userId: string, sink: unknown[], displayName = userId): RoomConn {
  return {
    id,
    userId,
    role: 'VIEWER',
    studentId: userId,
    displayName,
    send: (m) => sink.push(m),
  };
}

describe('RoomRegistry', () => {
  it('joins, broadcasts to all, and leaves', () => {
    const reg = new RoomRegistry();
    const a: unknown[] = [];
    const b: unknown[] = [];
    reg.join('w1', conn('a', 'ua', a));
    reg.join('w1', conn('b', 'ub', b));
    reg.broadcast('w1', { t: 'presence:count', count: 2 });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    reg.leave('w1', 'a');
    reg.broadcast('w1', { t: 'webinar:ended' });
    expect(a).toHaveLength(1); // gone
    expect(b).toHaveLength(2);
  });

  it('presence counts distinct users, not connections (multi-tab)', () => {
    const reg = new RoomRegistry();
    const sink: unknown[] = [];
    reg.join('w1', conn('c1', 'sameUser', sink));
    reg.join('w1', conn('c2', 'sameUser', sink));
    reg.join('w1', conn('c3', 'other', sink));
    expect(reg.presence('w1')).toBe(2);
    expect(reg.userConnectionCount('w1', 'sameUser')).toBe(2);
  });

  it('does not cross-broadcast between rooms', () => {
    const reg = new RoomRegistry();
    const a: unknown[] = [];
    reg.join('w1', conn('a', 'ua', a));
    reg.broadcast('w2', { t: 'presence:count', count: 9 });
    expect(a).toHaveLength(0);
  });

  it('drain empties the room and returns its connections', () => {
    const reg = new RoomRegistry();
    const sink: unknown[] = [];
    reg.join('w1', conn('a', 'ua', sink));
    reg.join('w1', conn('b', 'ub', sink));
    const drained = reg.drain('w1');
    expect(drained).toHaveLength(2);
    expect(reg.presence('w1')).toBe(0);
  });
});

describe('RoomRegistry — interview signaling (directed send + roster)', () => {
  it('sendTo delivers to exactly one peer, and reports missing targets', () => {
    const reg = new RoomRegistry();
    const a: unknown[] = [];
    const b: unknown[] = [];
    reg.join('iv', conn('peerA', 'ua', a));
    reg.join('iv', conn('peerB', 'ub', b));
    const ok = reg.sendTo('iv', 'peerB', { t: 'rtc:offer', from: 'peerA', sdp: 'v=0' });
    expect(ok).toBe(true);
    expect(b).toHaveLength(1);
    expect(a).toHaveLength(0); // NOT broadcast — directed only
    expect(reg.sendTo('iv', 'ghost', { t: 'rtc:ice', from: 'peerA', candidate: null })).toBe(false);
  });

  it('broadcastExcept skips the sender (used for code/whiteboard)', () => {
    const reg = new RoomRegistry();
    const a: unknown[] = [];
    const b: unknown[] = [];
    reg.join('iv', conn('peerA', 'ua', a));
    reg.join('iv', conn('peerB', 'ub', b));
    reg.broadcastExcept('iv', 'peerA', { t: 'code:update', from: 'peerA', content: 'x=1' });
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  it('roster lists peers with id + name + role', () => {
    const reg = new RoomRegistry();
    reg.join('iv', conn('peerA', 'ua', [], 'Asha'));
    reg.join('iv', conn('peerB', 'ub', [], 'Bala'));
    const roster = reg.roster('iv');
    expect(roster).toHaveLength(2);
    expect(roster.map((p) => p.peerId).sort()).toEqual(['peerA', 'peerB']);
    expect(roster.find((p) => p.peerId === 'peerA')?.displayName).toBe('Asha');
  });
});

describe('parseInbound', () => {
  it('accepts valid frames', () => {
    expect(parseInbound(JSON.stringify({ t: 'chat:send', body: 'hi' }))).toEqual({
      ok: true,
      msg: { t: 'chat:send', body: 'hi' },
    });
    expect(parseInbound(JSON.stringify({ t: 'presence:heartbeat' })).ok).toBe(true);
  });
  it('rejects malformed JSON and unknown/invalid frames', () => {
    expect(parseInbound('not json').ok).toBe(false);
    expect(parseInbound(JSON.stringify({ t: 'chat:send', body: '' })).ok).toBe(false);
    expect(parseInbound(JSON.stringify({ t: 'evil' })).ok).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('bursts then blocks, refilling over time', () => {
    const t0 = 1000;
    const rl = new RateLimiter(t0);
    let allowed = 0;
    for (let i = 0; i < 5; i += 1) if (rl.allow(t0)) allowed += 1;
    expect(allowed).toBe(5);
    expect(rl.allow(t0)).toBe(false);
    expect(rl.allow(t0 + 1000)).toBe(true); // one token refilled after 1s
  });
});

describe('tokenFromUrl', () => {
  it('extracts the token query param', () => {
    expect(tokenFromUrl('/ws?token=abc.def')).toBe('abc.def');
    expect(tokenFromUrl('/ws')).toBeNull();
    expect(tokenFromUrl(undefined)).toBeNull();
  });
});
