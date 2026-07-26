import { z } from 'zod';

/**
 * Phase 8 — Webinars. A webinar is a one-to-many live session (HLS media, out of
 * band) plus a real-time room (chat / polls / presence / attendance) carried by
 * the ws-gateway over WSS. This file is the single source of truth shared by the
 * api (mints RT tokens, owns CRUD + lifecycle + polls), the ws-gateway (verifies
 * tokens, runs the room), and the web client.
 */

// ---- Enums (mirror schema.prisma) -------------------------------------------

export const WEBINAR_STATUSES = ['DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED'] as const;
export type WebinarStatus = (typeof WEBINAR_STATUSES)[number];

export const WEBINAR_HOST_KINDS = ['UNIVERSITY', 'COMPANY'] as const;
export type WebinarHostKind = (typeof WEBINAR_HOST_KINDS)[number];

export const POLL_STATUSES = ['OPEN', 'CLOSED'] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

// ---- Bounds (shared by api + gateway; keep the room bounded) ----------------

export const CHAT_MAX_LENGTH = 2000;
export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 200;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
/** Per-connection chat send budget at the gateway (token bucket). */
export const CHAT_RATE = { capacity: 5, refillPerSec: 1 } as const;
/** How often a live client pings presence; the gateway treats 2.5× as stale. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** Recent chat history the room loads on join. */
export const CHAT_HISTORY_LIMIT = 50;

// ---- Request schemas --------------------------------------------------------

const title = z.string().trim().min(3).max(200);
const description = z.string().trim().min(1).max(10_000);

/** `POST /webinars` — create a DRAFT. Company hosts pick a target university. */
export const webinarCreateSchema = z.object({
  title,
  description,
  // For a UNIVERSITY host this may be omitted (uses its own); a COMPANY host must
  // supply it.
  targetUniversityPublicId: z.string().uuid().optional(),
  scheduledStartsAt: z.string().datetime(),
});
export type WebinarCreateInput = z.infer<typeof webinarCreateSchema>;

export const webinarUpdateSchema = z
  .object({
    title,
    description,
    scheduledStartsAt: z.string().datetime(),
  })
  .partial();
export type WebinarUpdateInput = z.infer<typeof webinarUpdateSchema>;

/** `POST /webinars/:id/polls` — host opens a poll. */
export const pollCreateSchema = z.object({
  question: z.string().trim().min(1).max(POLL_QUESTION_MAX),
  options: z
    .array(z.string().trim().min(1).max(POLL_OPTION_MAX))
    .min(POLL_MIN_OPTIONS)
    .max(POLL_MAX_OPTIONS),
});
export type PollCreateInput = z.infer<typeof pollCreateSchema>;

// ---- Response DTOs ----------------------------------------------------------

export interface WebinarHostRef {
  kind: WebinarHostKind;
  name: string;
}

export interface WebinarListItem {
  publicId: string;
  title: string;
  status: WebinarStatus;
  scheduledStartsAt: string; // ISO
  startedAt: string | null;
  endedAt: string | null;
  host: WebinarHostRef;
  targetUniversity: { publicId: string; name: string };
  canManage: boolean;
}

export interface WebinarListResponse {
  webinars: WebinarListItem[];
}

/** Host-only ingest credentials — NEVER serialized to a viewer. */
export interface WebinarIngest {
  ingestUrl: string;
  streamKey: string;
}

export interface WebinarDetail {
  publicId: string;
  title: string;
  description: string;
  status: WebinarStatus;
  scheduledStartsAt: string; // ISO
  startedAt: string | null;
  endedAt: string | null;
  host: WebinarHostRef;
  targetUniversity: { publicId: string; name: string };
  canManage: boolean;
  /** Viewer HLS manifest — null with the stub provider / before live. */
  playbackUrl: string | null;
  /** Present only when `canManage` (host). Viewers never receive this. */
  ingest?: WebinarIngest;
}

export interface WebinarMessageDto {
  publicId: string;
  senderName: string;
  senderPublicId: string;
  body: string;
  sentAt: string; // ISO
}

export interface WebinarMessagesResponse {
  messages: WebinarMessageDto[];
}

export interface PollOptionDto {
  publicId: string;
  text: string;
  ordinal: number;
  count: number;
}

/** A poll as seen by a viewer/host — aggregate counts only, never who-voted. */
export interface PollDto {
  publicId: string;
  question: string;
  status: PollStatus;
  options: PollOptionDto[];
  /** The caller's chosen option (viewer view), if they voted. */
  myVoteOptionPublicId?: string | null;
}

export interface PollsResponse {
  polls: PollDto[];
}

export interface AttendanceRow {
  studentPublicId: string;
  displayName: string;
  firstJoinedAt: string; // ISO
  lastSeenAt: string; // ISO
  attendedSeconds: number;
  present: boolean;
}

export interface AttendanceResponse {
  attendance: AttendanceRow[];
}

/** `GET /webinars/:id/rt-token` — a short-lived credential to open the socket. */
export interface RtTokenResponse {
  token: string;
  /** Absolute ws-gateway URL the client should connect to (from config). */
  url: string;
  /** Seconds until the token expires (client refreshes before this). */
  expiresIn: number;
}

// ---- RT token payload (signed by the api, verified by the gateway) ----------

/**
 * A room the gateway can serve. Phase 8 introduced `webinar`; Phase 9 reuses the
 * exact same token + gateway for `interview` rooms.
 */
export type RtRoomKind = 'webinar' | 'interview';

/**
 * Role within a room. Webinars use HOST/VIEWER; interviews use INTERVIEWER/
 * CANDIDATE. Kept a single union so one token type serves both room kinds.
 */
export type RtRole = 'HOST' | 'VIEWER' | 'INTERVIEWER' | 'CANDIDATE';

export interface RtTokenPayload {
  /** Which gateway room kind this token authorizes. */
  kind: RtRoomKind;
  /** Internal room id — the gateway loads the room by this (webinar/interview id). */
  roomId: string;
  roomPublicId: string;
  userId: string;
  publicId: string;
  role: RtRole;
  displayName: string;
  /** Student id — present for a webinar VIEWER (drives attendance) or a candidate. */
  studentId?: string;
  exp: number; // epoch seconds
}

// ---- WSS event contract (client <-> gateway) --------------------------------
//
// Wire format: JSON `{ "t": <type>, ...payload }`. Kept tiny + explicit so the
// gateway can validate every inbound frame and Phase 9's interview room can
// reuse the same envelope.

export const RT_MESSAGE_TYPES = ['chat:send', 'poll:vote', 'presence:heartbeat'] as const;
export type RtClientMessageType = (typeof RT_MESSAGE_TYPES)[number];

/** Inbound (client → gateway) frame validation. */
export const rtClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('chat:send'), body: z.string().trim().min(1).max(CHAT_MAX_LENGTH) }),
  z.object({
    t: z.literal('poll:vote'),
    pollId: z.string().uuid(),
    optionId: z.string().uuid(),
  }),
  z.object({ t: z.literal('presence:heartbeat') }),
]);
export type RtClientMessage = z.infer<typeof rtClientMessageSchema>;

/** Outbound (gateway → client) frames. */
export type RtServerMessage =
  | { t: 'ready'; role: 'HOST' | 'VIEWER'; presence: number }
  | { t: 'chat:new'; message: WebinarMessageDto }
  | { t: 'presence:count'; count: number }
  | { t: 'poll:opened'; poll: PollDto }
  | { t: 'poll:results'; pollId: string; counts: { optionPublicId: string; count: number }[] }
  | { t: 'poll:closed'; pollId: string }
  | { t: 'webinar:ended' }
  | { t: 'error'; code: string; message: string };

// ---- Redis fan-out channel (api → gateway, gateway → gateway) ---------------

/** The pub/sub channel a webinar's room events are published on. */
export function webinarChannel(webinarId: string): string {
  return `webinar:${webinarId}`;
}

/** Events published to `webinarChannel` (relayed to every room member). */
export type WebinarBusEvent =
  | { t: 'chat:new'; message: WebinarMessageDto }
  | { t: 'poll:opened'; poll: PollDto }
  | { t: 'poll:results'; pollId: string; counts: { optionPublicId: string; count: number }[] }
  | { t: 'poll:closed'; pollId: string }
  | { t: 'webinar:ended' };

// ---- Pure attendance accumulation (unit-tested; used by the gateway) --------

export interface AttendanceState {
  firstJoinedAt: number; // epoch ms
  lastSeenAt: number; // epoch ms
  attendedSeconds: number;
  present: boolean;
  /** When the current present interval began; null while absent. */
  presentSince: number | null;
}

/** Begin (or resume) a present interval. Idempotent across flaky reconnects. */
export function attendanceOnJoin(prev: AttendanceState | null, now: number): AttendanceState {
  if (!prev) {
    return {
      firstJoinedAt: now,
      lastSeenAt: now,
      attendedSeconds: 0,
      present: true,
      presentSince: now,
    };
  }
  // Already present (duplicate/overlapping socket) — do not reset the interval.
  if (prev.present && prev.presentSince != null) {
    return { ...prev, lastSeenAt: now };
  }
  return { ...prev, present: true, presentSince: now, lastSeenAt: now };
}

/** Heartbeat — advance lastSeenAt without changing the accumulated total. */
export function attendanceOnHeartbeat(prev: AttendanceState, now: number): AttendanceState {
  return { ...prev, lastSeenAt: now };
}

/** End the present interval, folding its duration into the running total. */
export function attendanceOnLeave(prev: AttendanceState, now: number): AttendanceState {
  if (!prev.present || prev.presentSince == null) {
    return { ...prev, present: false, presentSince: null, lastSeenAt: now };
  }
  const delta = Math.max(0, Math.floor((now - prev.presentSince) / 1000));
  return {
    ...prev,
    attendedSeconds: prev.attendedSeconds + delta,
    present: false,
    presentSince: null,
    lastSeenAt: now,
  };
}

/** Attended seconds *right now* (folds an in-progress present interval). */
export function attendedSecondsNow(s: AttendanceState, now: number): number {
  if (s.present && s.presentSince != null) {
    return s.attendedSeconds + Math.max(0, Math.floor((now - s.presentSince) / 1000));
  }
  return s.attendedSeconds;
}

// ---- Pure token-bucket rate limiter (unit-tested; used by the gateway) ------

export interface TokenBucket {
  tokens: number;
  updatedAt: number; // epoch ms
}

export function newBucket(capacity: number, now: number): TokenBucket {
  return { tokens: capacity, updatedAt: now };
}

/**
 * Try to spend one token. Returns the next bucket + whether it was allowed.
 * Refills continuously at `refillPerSec` up to `capacity`.
 */
export function takeToken(
  bucket: TokenBucket,
  cfg: { capacity: number; refillPerSec: number },
  now: number,
): { bucket: TokenBucket; allowed: boolean } {
  const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1000);
  const refilled = Math.min(cfg.capacity, bucket.tokens + elapsedSec * cfg.refillPerSec);
  if (refilled >= 1) {
    return { bucket: { tokens: refilled - 1, updatedAt: now }, allowed: true };
  }
  return { bucket: { tokens: refilled, updatedAt: now }, allowed: false };
}
