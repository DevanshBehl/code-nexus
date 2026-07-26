import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Redis } from 'ioredis';
import { loadConfig } from '@code-nexus/config';
import { createLogger } from '@code-nexus/logger';
import { prisma } from '@code-nexus/db';
import { HEARTBEAT_INTERVAL_MS, type InterviewQuestion } from '@code-nexus/types';
import { RateLimiter, RoomRegistry, parseInbound, type RoomConn } from './rooms.js';
import { authenticate } from './token.js';
import {
  attendanceHeartbeat,
  attendanceJoin,
  attendanceLeave,
  interviewStartedAt,
  isInterviewLive,
  isWebinarLive,
  persistChat,
  persistEvents,
  persistVote,
} from './handlers.js';
import { EventBuffer } from './events.js';
import {
  clearRoomState,
  handleInterviewConnection,
  type CodeSnapshots,
  type RoomQuestions,
  type RoomSurfaces,
} from './interview.js';

/**
 * The Code Nexus ws-gateway — the platform's real-time plane, a STANDALONE
 * process (not the API). It authenticates each socket with a short-lived RT token
 * minted by the api and serves TWO room kinds from one place (dispatched by the
 * token's `kind`): Phase-8 **webinars** (chat / polls / presence / attendance) and
 * Phase-9 **interviews** (WebRTC signaling / shared code / whiteboard / chat).
 * Rooms fan out via Redis pub/sub so N gateway instances stay in sync. It touches
 * NO media bytes — webinar media is HLS and interview media is WebRTC P2P, both
 * out of band.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    level: config.LOG_LEVEL,
    name: 'ws-gateway',
    pretty: config.NODE_ENV === 'development',
  });

  // Two Redis connections: one to publish room events, one (subscriber mode) to
  // receive them. A single psubscribe covers every active room.
  const pub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  pub.on('error', (err) => logger.debug({ err }, 'redis pub error'));
  sub.on('error', (err) => logger.debug({ err }, 'redis sub error'));
  try {
    await Promise.all([pub.connect(), sub.connect()]);
  } catch (err) {
    logger.fatal({ err }, 'Cannot reach Redis — aborting boot');
    process.exit(1);
  }

  const registry = new RoomRegistry();
  // Per-student presence bookkeeping for webinar attendance: refs de-dupes tabs;
  // `since` marks when the current present interval began (folded on last leave).
  const presence = new Map<string, { since: number; refs: number }>();
  const pKey = (webinarId: string, studentId: string): string => `${webinarId}:${studentId}`;
  // Per-interview shared room state, replayed to late joiners: the code document,
  // the stage everyone is looking at, and the question the interviewer pinned.
  const codeSnapshots: CodeSnapshots = new Map();
  const surfaces: RoomSurfaces = new Map();
  const questions: RoomQuestions = new Map();
  const interviewState = { codeSnapshots, surfaces, questions };
  // Phase 10 — the review timeline. Batched so a burst of joins/switches is one
  // insert, and drained on shutdown so the last marks are never lost.
  const events = new EventBuffer(persistEvents);
  events.start();

  // ---- Redis fan-out: relay api-originated bus events to the local room -----
  // Both `webinar:*` and `interview:*` channels are api → gateway host events.
  await sub.psubscribe('webinar:*', 'interview:*');
  sub.on('pmessage', (_pattern, channel, message) => {
    const roomId = channel.slice(channel.indexOf(':') + 1);
    let event: { t: string } & Partial<{ question: InterviewQuestion | null }>;
    try {
      event = JSON.parse(message) as typeof event;
    } catch {
      return;
    }
    // Bus events are a subset of the room's server contract — relay verbatim.
    registry.broadcast(roomId, event);
    // A pinned question is room state, not just a notification: cache it so a
    // peer who joins (or reconnects) after the interviewer set it still sees it.
    if (event.t === 'question:set') questions.set(roomId, event.question ?? null);
    if (event.t === 'webinar:ended' || event.t === 'interview:ended') {
      registry.drain(roomId);
      clearRoomState(roomId, interviewState);
      // Sockets close themselves on the frame; drain frees the room map.
    }
  });

  // ---- The WebSocket server -------------------------------------------------
  const wss = new WebSocketServer({ port: config.WS_GATEWAY_PORT, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    void handleConnection(ws, req);
  });

  async function handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const payload = authenticate(req.url, config.RT_TOKEN_SECRET);
    if (!payload) {
      ws.close(4401, 'unauthorized');
      return;
    }

    // Dispatch by room kind — interviews reuse the same gateway/registry.
    if (payload.kind === 'interview') {
      if (!(await isInterviewLive(payload.roomId))) {
        ws.close(4404, 'not live');
        return;
      }
      // The interview's start time anchors every timeline offset.
      const startedAt = await interviewStartedAt(payload.roomId);
      handleInterviewConnection(ws, payload, {
        registry,
        ...interviewState,
        events,
        startedAt,
      });
      return;
    }

    // ---- Webinar room (Phase 8) ----------------------------------------------
    if (!(await isWebinarLive(payload.roomId))) {
      ws.close(4404, 'not live');
      return;
    }

    const webinarId = payload.roomId;
    const connId = randomUUID();
    const limiter = new RateLimiter();
    let lastSeen = Date.now();

    const conn: RoomConn = {
      id: connId,
      userId: payload.userId,
      role: payload.role,
      studentId: payload.studentId,
      send: (msg: unknown) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    registry.join(webinarId, conn);

    // Attendance (viewers only): first tab opens a present interval.
    if (payload.role === 'VIEWER' && payload.studentId) {
      const key = pKey(webinarId, payload.studentId);
      const p = presence.get(key);
      if (!p) {
        presence.set(key, { since: Date.now(), refs: 1 });
        await attendanceJoin(webinarId, payload.studentId);
      } else {
        p.refs += 1;
      }
    }

    conn.send({ t: 'ready', role: payload.role, presence: registry.presence(webinarId) });
    registry.broadcast(webinarId, { t: 'presence:count', count: registry.presence(webinarId) });

    ws.on('message', (data) => {
      void onMessage(data.toString());
    });
    ws.on('close', () => {
      void onClose();
    });
    ws.on('error', () => {
      /* surfaced as a close */
    });

    async function onMessage(raw: string): Promise<void> {
      lastSeen = Date.now();
      const parsed = parseInbound(raw);
      if (!parsed.ok) {
        conn.send({ t: 'error', code: 'BAD_FRAME', message: 'Invalid message' });
        return;
      }
      const msg = parsed.msg;
      if (msg.t === 'chat:send') {
        if (!limiter.allow()) {
          conn.send({ t: 'error', code: 'RATE_LIMITED', message: 'Slow down' });
          return;
        }
        const message = await persistChat(
          webinarId,
          {
            userId: payload!.userId,
            publicId: payload!.publicId,
            displayName: payload!.displayName,
          },
          msg.body,
        );
        await pub.publish(`webinar:${webinarId}`, JSON.stringify({ t: 'chat:new', message }));
        return;
      }
      if (msg.t === 'poll:vote') {
        const result = await persistVote(webinarId, msg.pollId, msg.optionId, payload!.userId);
        if (!result) {
          conn.send({ t: 'error', code: 'BAD_VOTE', message: 'Poll is not open' });
          return;
        }
        await pub.publish(
          `webinar:${webinarId}`,
          JSON.stringify({ t: 'poll:results', pollId: msg.pollId, counts: result.counts }),
        );
        return;
      }
      // presence:heartbeat
      if (payload!.role === 'VIEWER' && payload!.studentId) {
        await attendanceHeartbeat(webinarId, payload!.studentId);
      }
    }

    async function onClose(): Promise<void> {
      registry.leave(webinarId, connId);
      if (payload!.role === 'VIEWER' && payload!.studentId) {
        const key = pKey(webinarId, payload!.studentId);
        const p = presence.get(key);
        if (p) {
          p.refs -= 1;
          if (p.refs <= 0) {
            presence.delete(key);
            await attendanceLeave(webinarId, payload!.studentId, (Date.now() - p.since) / 1000);
          }
        }
      }
      registry.broadcast(webinarId, { t: 'presence:count', count: registry.presence(webinarId) });
    }

    // Stale-connection sweep: terminate a socket that goes quiet for too long.
    const stale = setInterval(() => {
      if (Date.now() - lastSeen > HEARTBEAT_INTERVAL_MS * 3) {
        ws.terminate();
      }
    }, HEARTBEAT_INTERVAL_MS);
    ws.on('close', () => clearInterval(stale));
  }

  logger.info(
    { port: config.WS_GATEWAY_PORT, media: config.MEDIA_PROVIDER },
    'ws-gateway listening',
  );

  // ---- Graceful shutdown ----------------------------------------------------
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down ws-gateway');
    for (const client of wss.clients) client.close(1001, 'server shutting down');
    wss.close();
    events.stop();
    // Drain buffered timeline rows BEFORE disconnecting Prisma, or the last
    // few marks of every live room are lost on every deploy.
    void events
      .flush()
      .finally(() =>
        Promise.allSettled([pub.quit(), sub.quit(), prisma.$disconnect()]).finally(() =>
          process.exit(0),
        ),
      );
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal ws-gateway boot error:', err);
  process.exit(1);
});
