import type { WebSocket } from 'ws';
import {
  canEditSharedCode,
  interviewClientMessageSchema,
  DEFAULT_INTERVIEW_SURFACE,
  type InterviewQuestion,
  type InterviewServerMessage,
  type InterviewSurface,
  type RtTokenPayload,
} from '@code-nexus/types';
import { RateLimiter, type RoomRegistry } from './rooms.js';
import { buildEvent, surfaceEventLabel, type EventBuffer } from './events.js';

/**
 * Interview-room connection handling for the ws-gateway (Phase 9). It reuses the
 * shared RoomRegistry but adds WebRTC signaling (DIRECTED peer-to-peer relay),
 * a shared code editor (broadcast + a per-room snapshot for late joiners), a
 * whiteboard, and ephemeral chat. The gateway is a dumb relay — it never parses
 * SDP and never touches media bytes.
 *
 * The room also holds SHARED VIEW STATE: which surface everyone is looking at
 * (call / whiteboard / IDE) and which question is pinned. Both are cached per
 * room so a reconnecting or late-joining peer lands on the same screen as the
 * others instead of a stale default.
 */

/** Per-room latest shared-code snapshot, so a late joiner gets the current doc. */
export type CodeSnapshots = Map<string, string>;
/** Per-room shared stage — everyone sees the same surface. */
export type RoomSurfaces = Map<string, InterviewSurface>;
/** Per-room pinned question (set by an interviewer through the api, relayed here). */
export type RoomQuestions = Map<string, InterviewQuestion | null>;

/** Forget every scrap of a room's shared state (called when it empties or ends). */
export function clearRoomState(
  roomId: string,
  state: { codeSnapshots: CodeSnapshots; surfaces: RoomSurfaces; questions: RoomQuestions },
): void {
  state.codeSnapshots.delete(roomId);
  state.surfaces.delete(roomId);
  state.questions.delete(roomId);
}

/** Parse + validate an inbound interview frame. Never throws. */
function parseInterviewInbound(raw: string) {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = interviewClientMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export interface InterviewConnDeps {
  registry: RoomRegistry;
  codeSnapshots: CodeSnapshots;
  surfaces: RoomSurfaces;
  questions: RoomQuestions;
  /** Phase 10 — timeline sink. Absent in tests that do not care about events. */
  events?: EventBuffer;
  /**
   * When the interview went live — the zero point every timeline offset is
   * measured from. Null when unknown, in which case nothing is logged.
   */
  startedAt?: Date | null;
}

/**
 * Wire a verified interview socket into its room. Returns a disposer the caller
 * runs on close. Pure-ish: all room mutations go through the registry; the only
 * side effect is `ws.send`/`ws.close` (injected by the socket glue).
 */
export function handleInterviewConnection(
  ws: WebSocket,
  payload: RtTokenPayload,
  deps: InterviewConnDeps,
): void {
  const { registry, codeSnapshots, surfaces, questions, events, startedAt = null } = deps;
  const roomId = payload.roomId;
  const peerId = cryptoRandom();
  const limiter = new RateLimiter();

  /** Queue a timeline row (no-op when there is no sink or no start time). */
  const logEvent = (
    kind: Parameters<typeof buildEvent>[0]['kind'],
    label?: string,
    meta?: Record<string, unknown>,
  ): void => {
    events?.add(
      buildEvent({
        interviewId: roomId,
        startedAt,
        at: Date.now(),
        kind,
        actorUserId: payload.userId,
        label: label ?? payload.displayName,
        ...(meta ? { meta } : {}),
      }),
    );
  };

  const send = (msg: InterviewServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  registry.join(roomId, {
    id: peerId,
    userId: payload.userId,
    role: payload.role,
    displayName: payload.displayName,
    send: (m) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    },
  });

  // Tell the newcomer who's already here; tell everyone else a peer joined.
  const others = registry.roster(roomId).filter((p) => p.peerId !== peerId);
  send({ t: 'ready', peerId, role: payload.role, peers: others });
  registry.broadcastExcept(roomId, peerId, {
    t: 'peer:joined',
    peer: { peerId, displayName: payload.displayName, role: payload.role },
  });
  registry.broadcast(roomId, { t: 'presence:count', count: registry.presence(roomId) });
  logEvent('PARTICIPANT_JOINED');

  // Catch the newcomer up on everything the room already shares, so they land on
  // the same screen as everyone else: the code document, the pinned question, and
  // the active surface (only when it differs from the default — no wasted frame).
  const snapshot = codeSnapshots.get(roomId);
  if (snapshot != null) send({ t: 'code:sync', content: snapshot });
  const pinned = questions.get(roomId);
  if (pinned) send({ t: 'question:set', question: pinned });
  const surface = surfaces.get(roomId) ?? DEFAULT_INTERVIEW_SURFACE;
  if (surface !== DEFAULT_INTERVIEW_SURFACE) send({ t: 'surface:changed', surface, by: peerId });

  ws.on('message', (data) => {
    const msg = parseInterviewInbound(data.toString());
    if (!msg) {
      send({ t: 'error', code: 'BAD_FRAME', message: 'Invalid message' });
      return;
    }
    switch (msg.t) {
      case 'rtc:offer':
        registry.sendTo(roomId, msg.to, { t: 'rtc:offer', from: peerId, sdp: msg.sdp });
        return;
      case 'rtc:answer':
        registry.sendTo(roomId, msg.to, { t: 'rtc:answer', from: peerId, sdp: msg.sdp });
        return;
      case 'rtc:ice':
        registry.sendTo(roomId, msg.to, { t: 'rtc:ice', from: peerId, candidate: msg.candidate });
        return;
      case 'code:update':
        // The IDE belongs to the candidate. Interviewers observe it live but may
        // not type into it — refuse server-side, never trust the client's UI.
        if (!canEditSharedCode(payload.role)) {
          send({ t: 'error', code: 'FORBIDDEN', message: 'Only the candidate can edit the code' });
          return;
        }
        codeSnapshots.set(roomId, msg.content);
        registry.broadcastExcept(roomId, peerId, {
          t: 'code:update',
          from: peerId,
          content: msg.content,
        });
        return;
      case 'surface:set':
        // Shared stage: remember it for late joiners, then move the WHOLE room —
        // the sender included, so every client converges on the gateway's value
        // instead of trusting its own optimistic guess.
        surfaces.set(roomId, msg.surface);
        registry.broadcast(roomId, { t: 'surface:changed', surface: msg.surface, by: peerId });
        // A surface switch is a real chapter boundary — unlike the typing and
        // drawing that happen *within* one, which are never logged.
        logEvent('SURFACE_CHANGED', surfaceEventLabel(msg.surface), { surface: msg.surface });
        return;
      case 'whiteboard:stroke':
        registry.broadcastExcept(roomId, peerId, {
          t: 'whiteboard:stroke',
          from: peerId,
          stroke: msg.stroke,
        });
        return;
      case 'chat:send':
        if (!limiter.allow()) {
          send({ t: 'error', code: 'RATE_LIMITED', message: 'Slow down' });
          return;
        }
        // Chat is ephemeral in an interview — broadcast, do not persist.
        registry.broadcast(roomId, {
          t: 'chat:new',
          message: {
            senderName: payload.displayName,
            senderPublicId: payload.publicId,
            body: msg.body,
            sentAt: new Date().toISOString(),
          },
        });
        return;
      case 'presence:heartbeat':
        return;
      default:
        return;
    }
  });

  ws.on('close', () => {
    registry.leave(roomId, peerId);
    logEvent('PARTICIPANT_LEFT');
    registry.broadcast(roomId, { t: 'peer:left', peerId });
    registry.broadcast(roomId, { t: 'presence:count', count: registry.presence(roomId) });
    // Drop the room's shared state once the last participant is gone.
    if (registry.presence(roomId) === 0) {
      clearRoomState(roomId, { codeSnapshots, surfaces, questions });
    }
  });
}

function cryptoRandom(): string {
  // A short, comparable peer id (used by isOfferer's lexicographic election).
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
