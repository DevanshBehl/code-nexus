import {
  newBucket,
  rtClientMessageSchema,
  takeToken,
  CHAT_RATE,
  type InterviewPeer,
  type RtClientMessage,
  type RtRole,
  type TokenBucket,
} from '@code-nexus/types';

/**
 * Pure real-time room logic for the ws-gateway — a registry of connections keyed
 * by room id (a webinar OR an interview), plus inbound-frame parsing and a
 * per-connection rate limiter. It holds no sockets of its own: a "connection" is
 * just an id + a `send` callback, so every branch here is unit-testable without a
 * real WebSocket. The socket wiring in `index.ts` is thin glue over this. `send`
 * accepts `unknown` because the registry is a pure relay — it serves both the
 * webinar (`RtServerMessage`) and interview (`InterviewServerMessage`) contracts.
 */

export interface RoomConn {
  id: string; // also the WebRTC peer id for interview rooms
  userId: string;
  role: RtRole;
  studentId?: string;
  displayName?: string;
  /** Deliver a server frame to this connection. */
  send: (msg: unknown) => void;
}

/** Registry of live connections, grouped into per-room maps. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Map<string, RoomConn>>();

  join(webinarId: string, conn: RoomConn): void {
    let room = this.rooms.get(webinarId);
    if (!room) {
      room = new Map();
      this.rooms.set(webinarId, room);
    }
    room.set(conn.id, conn);
  }

  leave(webinarId: string, connId: string): void {
    const room = this.rooms.get(webinarId);
    if (!room) return;
    room.delete(connId);
    if (room.size === 0) this.rooms.delete(webinarId);
  }

  /** Connections currently in a room (empty if none). */
  connections(webinarId: string): RoomConn[] {
    return [...(this.rooms.get(webinarId)?.values() ?? [])];
  }

  /** Distinct participants (by user) — the presence count shown to the room. */
  presence(webinarId: string): number {
    const room = this.rooms.get(webinarId);
    if (!room) return 0;
    const users = new Set<string>();
    for (const c of room.values()) users.add(c.userId);
    return users.size;
  }

  /** How many live connections a given user has in a room (tab de-duplication). */
  userConnectionCount(webinarId: string, userId: string): number {
    const room = this.rooms.get(webinarId);
    if (!room) return 0;
    let n = 0;
    for (const c of room.values()) if (c.userId === userId) n += 1;
    return n;
  }

  /** Broadcast a frame to every connection in a room. */
  broadcast(roomId: string, msg: unknown): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const c of room.values()) c.send(msg);
  }

  /** Broadcast a frame to everyone in a room EXCEPT one connection (the sender). */
  broadcastExcept(roomId: string, exceptId: string, msg: unknown): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const c of room.values()) if (c.id !== exceptId) c.send(msg);
  }

  /**
   * Deliver a frame to ONE peer (directed WebRTC signaling). Returns whether the
   * target was found — the gateway never broadcasts `rtc:*` frames.
   */
  sendTo(roomId: string, peerId: string, msg: unknown): boolean {
    const conn = this.rooms.get(roomId)?.get(peerId);
    if (!conn) return false;
    conn.send(msg);
    return true;
  }

  /** The peer roster for an interview room (id + name + role). */
  roster(roomId: string): InterviewPeer[] {
    return this.connections(roomId).map((c) => ({
      peerId: c.id,
      displayName: c.displayName ?? 'Participant',
      role: c.role,
    }));
  }

  /** Close out a room (used on webinar:ended / interview:ended) — returns conns. */
  drain(roomId: string): RoomConn[] {
    const conns = this.connections(roomId);
    this.rooms.delete(roomId);
    return conns;
  }
}

/** Parse + validate an inbound wire frame. Never throws. */
export function parseInbound(raw: string): { ok: true; msg: RtClientMessage } | { ok: false } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const parsed = rtClientMessageSchema.safeParse(json);
  return parsed.success ? { ok: true, msg: parsed.data } : { ok: false };
}

/** A per-connection token-bucket rate limiter for inbound chat frames. */
export class RateLimiter {
  private bucket: TokenBucket;
  constructor(now: number = Date.now()) {
    this.bucket = newBucket(CHAT_RATE.capacity, now);
  }
  /** Try to spend a token; returns true if the action is allowed. */
  allow(now: number = Date.now()): boolean {
    const r = takeToken(this.bucket, CHAT_RATE, now);
    this.bucket = r.bucket;
    return r.allowed;
  }
}
