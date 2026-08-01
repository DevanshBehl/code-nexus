import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import {
  INTERVIEW_CLOSE_REPLACED,
  type InterviewServerMessage,
  type RtRole,
  type RtTokenPayload,
} from '@code-nexus/types';
import { RoomRegistry } from './rooms.js';
import {
  closeLobby,
  handleInterviewConnection,
  type AdmittedUsers,
  type CodeSnapshots,
  type LobbyWaiters,
  type RoomQuestions,
  type RoomSurfaces,
} from './interview.js';

/**
 * Who is in an interview room, and who is merely at the door.
 *
 * The lobby is a SERVER boundary, not a screen. These tests hold it to that: a
 * waiting candidate must receive nothing from inside the room and be able to send
 * nothing into it, no matter what their client tries, until an interviewer opens
 * the door.
 *
 * The second half guards the other half of that answer: the roster is the set of
 * PEOPLE in the interview, one connection each. Every entry in it becomes a video
 * tile on everyone's screen, so a socket that outlived its page is not a leak to
 * shrug at — it is a duplicate of a real participant.
 */

const ROOM = 'room-1';

function state(): {
  registry: RoomRegistry;
  codeSnapshots: CodeSnapshots;
  surfaces: RoomSurfaces;
  questions: RoomQuestions;
  lobby: LobbyWaiters;
  admitted: AdmittedUsers;
} {
  return {
    registry: new RoomRegistry(),
    codeSnapshots: new Map(),
    surfaces: new Map(),
    questions: new Map(),
    lobby: new Map(),
    admitted: new Map(),
  };
}

function payload(role: RtRole, userId: string, displayName: string): RtTokenPayload {
  return {
    kind: 'interview',
    roomId: ROOM,
    roomPublicId: 'pub-1',
    userId,
    publicId: `u-${userId}`,
    role,
    displayName,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
}

type Listener = (data?: unknown) => void;

/** A WebSocket stand-in: records what was sent, replays what we feed it. */
function socket() {
  const sent: InterviewServerMessage[] = [];
  const listeners: Record<string, Listener[]> = {};
  /** How the server hung up on us, if it did (`[code, reason]`). */
  let closedWith: [number, string] | null = null;
  const fireClose = (): void => listeners.close?.forEach((fn) => fn());
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: (raw: string) => sent.push(JSON.parse(raw) as InterviewServerMessage),
    on: (event: string, fn: Listener) => {
      (listeners[event] ??= []).push(fn);
    },
    // A real socket closes asynchronously, but the ordering that matters to these
    // tests is "the server let go of it", which is synchronous either way.
    close: (code: number, reason: string) => {
      closedWith = [code, reason];
      ws.readyState = 3;
      fireClose();
    },
    terminate: () => {
      ws.readyState = 3;
      fireClose();
    },
  };
  return {
    ws: ws as unknown as WebSocket,
    sent,
    closedWith: () => closedWith,
    types: () => sent.map((m) => m.t),
    last: <T extends InterviewServerMessage['t']>(t: T) =>
      [...sent].reverse().find((m) => m.t === t) as Extract<InterviewServerMessage, { t: T }>,
    recv: (msg: unknown) => listeners.message?.forEach((fn) => fn(JSON.stringify(msg))),
    hangUp: fireClose,
  };
}

describe('interview lobby', () => {
  it('walks an interviewer straight in but parks a candidate outside', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    expect(host.types()).toContain('ready');

    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    expect(cand.types()).toContain('lobby:waiting');
    expect(cand.types()).not.toContain('ready');
    // Nobody in the room has been told a peer arrived — because none did.
    expect(host.types()).not.toContain('peer:joined');
    expect(deps.registry.presence(ROOM)).toBe(1);
    // The interviewer, though, is told somebody is at the door.
    expect(host.last('lobby:updated').waiting.map((w) => w.displayName)).toEqual(['Asha']);
  });

  it('refuses every in-room frame from a socket that has not been let in', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);
    const hostBefore = host.sent.length;

    cand.recv({ t: 'chat:send', body: 'hello?' });
    cand.recv({ t: 'code:update', content: 'print(1)' });
    cand.recv({ t: 'surface:set', surface: 'code' });

    expect(cand.sent.filter((m) => m.t === 'error')).toHaveLength(3);
    expect(cand.last('error').code).toBe('NOT_ADMITTED');
    // Crucially: none of it reached the room, and none of it stuck to room state.
    expect(host.sent.length).toBe(hostBefore);
    expect(deps.codeSnapshots.get(ROOM)).toBeUndefined();
    expect(deps.surfaces.get(ROOM)).toBeUndefined();
  });

  it('admits on the interviewer’s say-so, and only then joins the room', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    const waiting = host.last('lobby:updated').waiting;
    host.recv({ t: 'lobby:admit', peerId: waiting[0]!.peerId });

    expect(cand.types()).toContain('lobby:admitted');
    expect(cand.types()).toContain('ready');
    expect(host.types()).toContain('peer:joined');
    expect(deps.registry.presence(ROOM)).toBe(2);
    // Door closed behind them.
    expect(host.last('lobby:updated').waiting).toEqual([]);

    // And now the frames that were refused a moment ago go through.
    cand.recv({ t: 'code:update', content: 'print(1)' });
    expect(deps.codeSnapshots.get(ROOM)).toBe('print(1)');
  });

  it('turns a candidate away without letting them into the room', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    host.recv({ t: 'lobby:deny', peerId: host.last('lobby:updated').waiting[0]!.peerId });

    expect(cand.types()).toContain('lobby:denied');
    expect(cand.types()).not.toContain('ready');
    expect(deps.registry.presence(ROOM)).toBe(1);
  });

  it('does not let a candidate open the door for themselves', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    const me = host.last('lobby:updated').waiting[0]!.peerId;
    cand.recv({ t: 'lobby:admit', peerId: me });

    expect(cand.last('error').code).toBe('FORBIDDEN');
    expect(cand.types()).not.toContain('ready');
    expect(deps.registry.presence(ROOM)).toBe(1);
  });

  it('lets an admitted candidate reconnect without knocking again', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const first = socket();
    handleInterviewConnection(first.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);
    host.recv({ t: 'lobby:admit', peerId: host.last('lobby:updated').waiting[0]!.peerId });

    // Their wifi drops mid-answer and the client reconnects.
    first.hangUp();
    const again = socket();
    handleInterviewConnection(again.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    expect(again.types()).toContain('ready');
    expect(again.types()).not.toContain('lobby:waiting');
  });

  it('shows a late interviewer who is already waiting', () => {
    const deps = state();
    const first = socket();
    handleInterviewConnection(first.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    const second = socket();
    handleInterviewConnection(second.ws, payload('INTERVIEWER', 'u3', 'Panel'), deps);

    expect(second.last('lobby:updated').waiting.map((w) => w.displayName)).toEqual(['Asha']);
  });

  it('drops a candidate who gives up waiting, and says so', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    cand.hangUp();

    expect(host.last('lobby:updated').waiting).toEqual([]);
    // They never joined, so the room must not hear a departure it never had.
    expect(host.types()).not.toContain('peer:left');
  });

  it('does not leave a second knock at the door when the same person re-opens the page', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const first = socket();
    handleInterviewConnection(first.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);
    // Their tab crashes; the server never hears about it. They open the page again.
    const second = socket();
    handleInterviewConnection(second.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    // One Asha at the door, not two — the interviewer has one decision to make.
    expect(host.last('lobby:updated').waiting.map((w) => w.displayName)).toEqual(['Asha']);
    expect(first.closedWith()?.[0]).toBe(INTERVIEW_CLOSE_REPLACED);
  });

  it('tells waiters when the interview ends under them', () => {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    closeLobby(deps.lobby, ROOM);

    expect(cand.types()).toContain('interview:ended');
    expect(deps.lobby.get(ROOM)).toBeUndefined();
  });
});

describe('one connection per person', () => {
  /** Admit u2, and hand back both sockets. */
  function liveRoom() {
    const deps = state();
    const host = socket();
    handleInterviewConnection(host.ws, payload('INTERVIEWER', 'u1', 'Acme'), deps);
    const cand = socket();
    handleInterviewConnection(cand.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);
    host.recv({ t: 'lobby:admit', peerId: host.last('lobby:updated').waiting[0]!.peerId });
    return { deps, host, cand };
  }

  it('retires the older socket when someone reloads into a live room', () => {
    const { deps, host, cand } = liveRoom();
    const oldPeerId = host.last('peer:joined').peer.peerId;

    // The candidate reloads. The old socket is still open as far as the server
    // knows — this is the exact shape of the "five tiles for two people" bug.
    const again = socket();
    handleInterviewConnection(again.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    expect(again.types()).toContain('ready');
    expect(cand.closedWith()).toEqual([INTERVIEW_CLOSE_REPLACED, 'replaced by a newer connection']);
    // Two people in the room, two connections, and the interviewer was told to
    // take the old tile down.
    expect(deps.registry.connections(ROOM)).toHaveLength(2);
    expect(deps.registry.presence(ROOM)).toBe(2);
    expect(host.sent.some((m) => m.t === 'peer:left' && m.peerId === oldPeerId)).toBe(true);
  });

  it('leaves the interviewer alone when the candidate reconnects', () => {
    const { deps, host } = liveRoom();
    const again = socket();
    handleInterviewConnection(again.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);

    // Eviction is per person: the other side of the interview never notices.
    expect(host.closedWith()).toBeNull();
    expect(again.last('ready').peers.map((p) => p.displayName)).toEqual(['Acme']);
  });

  it('does not tear the room down when the retired socket finally closes', () => {
    const { deps, cand } = liveRoom();
    const again = socket();
    handleInterviewConnection(again.ws, payload('CANDIDATE', 'u2', 'Asha'), deps);
    deps.codeSnapshots.set(ROOM, 'print(1)');

    // The dead socket's close arrives late, as it always does. It must not take
    // the room's shared state — or the newcomer — with it.
    cand.hangUp();

    expect(deps.registry.presence(ROOM)).toBe(2);
    expect(deps.codeSnapshots.get(ROOM)).toBe('print(1)');
  });
});
