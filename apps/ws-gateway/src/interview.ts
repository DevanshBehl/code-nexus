import type { WebSocket } from 'ws';
import {
  canAdmitToRoom,
  canEditSharedCode,
  interviewClientMessageSchema,
  needsAdmission,
  DEFAULT_INTERVIEW_SURFACE,
  INTERVIEW_CLOSE_REPLACED,
  INTERVIEW_HEARTBEAT_MS,
  INTERVIEW_STALE_AFTER_MS,
  type InterviewQuestion,
  type InterviewServerMessage,
  type InterviewSurface,
  type LobbyWaiter,
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
 *
 * It also holds the LOBBY. A candidate's socket connects but does not enter the
 * room: it parks in a per-room waiting map where it can neither send nor receive
 * anything from inside, and an interviewer admits or denies it. That boundary is
 * the whole point of the lobby, so it lives here and not in the UI — a waiting
 * socket is refused every in-room frame, whatever its client believes.
 */

/** Per-room latest shared-code snapshot, so a late joiner gets the current doc. */
export type CodeSnapshots = Map<string, string>;
/** Per-room shared stage — everyone sees the same surface. */
export type RoomSurfaces = Map<string, InterviewSurface>;
/** Per-room pinned question (set by an interviewer through the api, relayed here). */
export type RoomQuestions = Map<string, InterviewQuestion | null>;

/** One socket parked outside a room, waiting to be let in. */
export interface WaitingPeer {
  peerId: string;
  userId: string;
  displayName: string;
  requestedAt: number;
  /** Deliver a frame to someone who is not in the room (e.g. "it's over"). */
  send: (msg: InterviewServerMessage) => void;
  /** Let them in — runs the join their connection deferred. */
  admit: () => void;
  /** Turn them away; their client closes itself on the frame. */
  deny: () => void;
  /** Hang up on them (used when the same person knocks again from a newer tab). */
  close: (code: number, reason: string) => void;
}

/**
 * Tell everyone still at the door that there is no longer a room to wait for.
 * Waiters are not in the registry, so a plain room broadcast misses them — and a
 * candidate left staring at "waiting to be let in" after the interview ended is
 * the exact failure the lobby is supposed to prevent.
 */
export function closeLobby(lobby: LobbyWaiters, roomId: string): void {
  for (const w of lobby.get(roomId)?.values() ?? []) w.send({ t: 'interview:ended' });
  lobby.delete(roomId);
}

/** Per-room waiting area, keyed by peer id. */
export type LobbyWaiters = Map<string, Map<string, WaitingPeer>>;

/**
 * Users an interviewer has already let into a room this session.
 *
 * Without this a candidate whose wifi hiccups is dumped back into the lobby and
 * has to be admitted again mid-answer — a reconnect is not a new arrival. Scoped
 * to the room and dropped with the rest of its state, so it never outlives the
 * interview it was granted for.
 */
export type AdmittedUsers = Map<string, Set<string>>;

export interface InterviewRoomState {
  codeSnapshots: CodeSnapshots;
  surfaces: RoomSurfaces;
  questions: RoomQuestions;
  lobby: LobbyWaiters;
  admitted: AdmittedUsers;
}

/** Forget every scrap of a room's shared state (called when it empties or ends). */
export function clearRoomState(roomId: string, state: InterviewRoomState): void {
  state.codeSnapshots.delete(roomId);
  state.surfaces.delete(roomId);
  state.questions.delete(roomId);
  state.lobby.delete(roomId);
  state.admitted.delete(roomId);
}

/** The waiting list for a room, oldest knock first. */
export function lobbyList(lobby: LobbyWaiters, roomId: string): LobbyWaiter[] {
  return [...(lobby.get(roomId)?.values() ?? [])]
    .sort((a, b) => a.requestedAt - b.requestedAt)
    .map((w) => ({
      peerId: w.peerId,
      displayName: w.displayName,
      requestedAt: new Date(w.requestedAt).toISOString(),
    }));
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
  lobby: LobbyWaiters;
  admitted: AdmittedUsers;
  /** Phase 10 — timeline sink. Absent in tests that do not care about events. */
  events?: EventBuffer;
  /**
   * When the interview went live — the zero point every timeline offset is
   * measured from. Null when unknown, in which case nothing is logged.
   */
  startedAt?: Date | null;
}

/**
 * Wire a verified interview socket into its room — or into the room's lobby, if
 * its role has to be let in. All room mutations go through the registry; the only
 * side effects are `ws.send`/`ws.close` (injected by the socket glue).
 */
export function handleInterviewConnection(
  ws: WebSocket,
  payload: RtTokenPayload,
  deps: InterviewConnDeps,
): void {
  const {
    registry,
    codeSnapshots,
    surfaces,
    questions,
    lobby,
    admitted,
    events,
    startedAt = null,
  } = deps;
  const roomId = payload.roomId;
  const peerId = cryptoRandom();
  const limiter = new RateLimiter();
  /** False while this socket is parked in the lobby — it may send nothing inward. */
  let inRoom = false;
  /** Last inbound frame (the client heartbeats every `INTERVIEW_HEARTBEAT_MS`). */
  let lastSeen = Date.now();

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

  /** Push the current waiting list to everyone in the room who can act on it. */
  const notifyDoorkeepers = (): void => {
    const frame: InterviewServerMessage = { t: 'lobby:updated', waiting: lobbyList(lobby, roomId) };
    for (const c of registry.connections(roomId)) {
      if (canAdmitToRoom(c.role)) c.send(frame);
    }
  };

  /**
   * ONE LIVE CONNECTION PER PERSON. Retire every other socket this user still has
   * in this room the moment they arrive on a new one.
   *
   * An interview is a WebRTC mesh: the roster IS the set of tiles everybody
   * renders, so a socket that outlives its page — a reload, a second tab, a
   * StrictMode double-mount in dev, a laptop lid closed on a dead TCP connection —
   * does not merely linger, it puts a duplicate of that person on screen next to
   * themselves. A room booked for two must show two people.
   *
   * Newest wins, because the newest socket is the one attached to a page someone
   * is actually looking at. The retired socket is told why (`INTERVIEW_CLOSE_
   * REPLACED`) so its client stands down instead of reconnecting into a duel.
   */
  const retireOlderConnectionsOf = (userId: string): void => {
    for (const c of registry.connections(roomId)) {
      if (c.id === peerId || c.userId !== userId) continue;
      registry.leave(roomId, c.id);
      // Take the ghost off everyone's screen before the socket even finishes
      // closing — its own close handler is too late to be the only signal.
      registry.broadcast(roomId, { t: 'peer:left', peerId: c.id });
      c.close?.(INTERVIEW_CLOSE_REPLACED, 'replaced by a newer connection');
    }
    // And the same person's abandoned knocks, so an interviewer is never asked to
    // admit someone who is already sitting in the room.
    const waiting = lobby.get(roomId);
    if (!waiting) return;
    let dropped = false;
    for (const [id, w] of waiting) {
      if (id === peerId || w.userId !== userId) continue;
      waiting.delete(id);
      w.close(INTERVIEW_CLOSE_REPLACED, 'replaced by a newer connection');
      dropped = true;
    }
    if (dropped) notifyDoorkeepers();
  };

  /** Actually enter the room. Deferred for anyone who has to be admitted first. */
  const enterRoom = (): void => {
    if (inRoom) return;
    inRoom = true;
    // Remember the grant so a dropped connection can rejoin without knocking again.
    let seen = admitted.get(roomId);
    if (!seen) {
      seen = new Set();
      admitted.set(roomId, seen);
    }
    seen.add(payload.userId);

    registry.join(roomId, {
      id: peerId,
      userId: payload.userId,
      role: payload.role,
      displayName: payload.displayName,
      send: (m) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
      close: (code, reason) => ws.close(code, reason),
    });
    retireOlderConnectionsOf(payload.userId);

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

    // An interviewer walking in inherits the door: show them who is already there.
    if (canAdmitToRoom(payload.role))
      send({ t: 'lobby:updated', waiting: lobbyList(lobby, roomId) });
  };

  /** Park outside the room until an interviewer decides. */
  const enterLobby = (): void => {
    // One knock per person, for the same reason as one tile per person.
    retireOlderConnectionsOf(payload.userId);
    let waiting = lobby.get(roomId);
    if (!waiting) {
      waiting = new Map();
      lobby.set(roomId, waiting);
    }
    waiting.set(peerId, {
      peerId,
      userId: payload.userId,
      displayName: payload.displayName,
      requestedAt: Date.now(),
      send,
      close: (code, reason) => ws.close(code, reason),
      admit: () => {
        waiting.delete(peerId);
        send({ t: 'lobby:admitted' });
        enterRoom();
      },
      deny: () => {
        waiting.delete(peerId);
        send({ t: 'lobby:denied' });
      },
    });
    send({ t: 'lobby:waiting' });
    notifyDoorkeepers();
  };

  // The door. Interviewers walk in; a candidate knocks — unless an interviewer
  // already let this user in and the socket is simply coming back.
  const alreadyAdmitted = admitted.get(roomId)?.has(payload.userId) ?? false;
  if (needsAdmission(payload.role) && !alreadyAdmitted) {
    enterLobby();
  } else {
    enterRoom();
  }

  ws.on('message', (data) => {
    lastSeen = Date.now();
    const msg = parseInterviewInbound(data.toString());
    if (!msg) {
      send({ t: 'error', code: 'BAD_FRAME', message: 'Invalid message' });
      return;
    }

    // ---- Admission control (the only frames a waiting socket may exchange) ---
    if (msg.t === 'lobby:admit' || msg.t === 'lobby:deny') {
      if (!inRoom || !canAdmitToRoom(payload.role)) {
        send({ t: 'error', code: 'FORBIDDEN', message: 'Only an interviewer can admit' });
        return;
      }
      const target = lobby.get(roomId)?.get(msg.peerId);
      // A no-op is the honest outcome: they hung up, or another interviewer got
      // there first. Nothing to report, nothing to fix.
      if (!target) return;
      if (msg.t === 'lobby:admit') target.admit();
      else target.deny();
      notifyDoorkeepers();
      return;
    }

    // Everything below is an IN-ROOM action. A socket still in the lobby has no
    // business reaching the room — this is the boundary the lobby exists for.
    if (!inRoom) {
      if (msg.t !== 'presence:heartbeat') {
        send({ t: 'error', code: 'NOT_ADMITTED', message: 'You have not been let in yet' });
      }
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
    // Someone who gave up waiting never entered the room, so none of the leave
    // bookkeeping applies to them — only the waiting list changes.
    if (!inRoom) {
      const waiting = lobby.get(roomId);
      if (waiting?.delete(peerId)) notifyDoorkeepers();
      return;
    }
    registry.leave(roomId, peerId);
    logEvent('PARTICIPANT_LEFT');
    registry.broadcast(roomId, { t: 'peer:left', peerId });
    registry.broadcast(roomId, { t: 'presence:count', count: registry.presence(roomId) });
    // Drop the room's shared state once the last participant is gone.
    if (registry.presence(roomId) === 0) {
      clearRoomState(roomId, { codeSnapshots, surfaces, questions, lobby, admitted });
    }
  });

  /**
   * Sweep out a socket that has gone quiet.
   *
   * A TCP connection that dies without a FIN — a lid closed, a tunnel dropped —
   * leaves a socket the server still believes in, and in a mesh room that reads
   * to everyone else as a person frozen in place. The client heartbeats every
   * `INTERVIEW_HEARTBEAT_MS`, so silence for three of them is the room's evidence
   * that nobody is on the other end. The webinar rooms have always done this; the
   * interview rooms, where each connection is a video tile, need it more.
   */
  const sweep = setInterval(() => {
    if (Date.now() - lastSeen > INTERVIEW_STALE_AFTER_MS) ws.terminate();
  }, INTERVIEW_HEARTBEAT_MS);
  // Never let the sweep be the reason the process (or a test run) stays alive.
  sweep.unref?.();
  ws.on('close', () => clearInterval(sweep));
}

function cryptoRandom(): string {
  // A short, comparable peer id (used by isOfferer's lexicographic election).
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
