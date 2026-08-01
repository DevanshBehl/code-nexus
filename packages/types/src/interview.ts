import { z } from 'zod';
import type { ApplicationStatus } from './drive.js';
import {
  DIFFICULTIES,
  TOPICS,
  type Difficulty,
  type ProgrammingLanguage,
  type SampleTestCase,
  type Topic,
} from './arena.js';
import type { RtRole } from './webinar.js';

/**
 * Phase 9 — Live Interviews. A 1:1 / small-panel call: WebRTC media peer-to-peer
 * (out of band), with signaling + a shared code editor + whiteboard + chat riding
 * the SAME ws-gateway introduced in Phase 8. This file is the single source of
 * truth shared by the api, the gateway, and the web client.
 */

// ---- Enums (mirror schema.prisma) -------------------------------------------

export const INTERVIEW_STATUSES = ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_HOST_KINDS = ['UNIVERSITY', 'COMPANY'] as const;
export type InterviewHostKind = (typeof INTERVIEW_HOST_KINDS)[number];

export const PARTICIPANT_ROLES = ['INTERVIEWER', 'CANDIDATE'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const FEEDBACK_RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] as const;
export type FeedbackRecommendation = (typeof FEEDBACK_RECOMMENDATIONS)[number];

/**
 * The room's SHARED stage. Everyone in an interview looks at the same surface —
 * when one participant opens the whiteboard or the IDE, it opens for the whole
 * room (the video tiles collapse to a filmstrip). `call` is the default: a plain
 * video call, no collaborative surface. Chat/people are LOCAL side panels and
 * deliberately not part of this.
 */
export const INTERVIEW_SURFACES = ['call', 'code', 'board'] as const;
export type InterviewSurface = (typeof INTERVIEW_SURFACES)[number];
export const DEFAULT_INTERVIEW_SURFACE: InterviewSurface = 'call';

// ---- Bounds (shared by api + gateway) ---------------------------------------

export const INTERVIEW_CHAT_MAX = 2000;
export const CODE_MAX_LENGTH = 100_000; // bound the synced document
export const FEEDBACK_NOTES_MAX = 5000;
export const INTERVIEW_HEARTBEAT_MS = 15_000;
/**
 * A socket that goes this long without a word is treated as gone and dropped.
 *
 * An interview room is a mesh: every connection in the roster becomes a tile on
 * everybody's screen, so a socket the server never saw die is not a harmless
 * leak — it is a second frozen copy of a real person in the call. Three missed
 * heartbeats is the same tolerance the webinar rooms use.
 */
export const INTERVIEW_STALE_AFTER_MS = INTERVIEW_HEARTBEAT_MS * 3;
/**
 * Close code for a connection the gateway retired because the same person opened
 * a newer one. Clients must NOT reconnect on it — one live socket per person per
 * room is the rule that keeps the roster equal to the people in the interview.
 */
export const INTERVIEW_CLOSE_REPLACED = 4409;
/** Per-connection chat send budget at the gateway (token bucket). */
export const INTERVIEW_CHAT_RATE = { capacity: 5, refillPerSec: 1 } as const;

// ---- Request schemas --------------------------------------------------------

/** `POST /interviews` — schedule (status SCHEDULED). */
export const interviewCreateSchema = z.object({
  title: z.string().trim().max(200).optional(),
  candidateStudentPublicId: z.string().uuid(),
  scheduledStartsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(10).max(240),
  // Optional linkage into the drive funnel + an optional live coding problem.
  applicationPublicId: z.string().uuid().optional(),
  questionSlug: z.string().trim().min(1).max(200).optional(),
  // Extra interviewer users (by publicId). The scheduler is always an interviewer.
  interviewerPublicIds: z.array(z.string().uuid()).max(8).optional(),
});
export type InterviewCreateInput = z.infer<typeof interviewCreateSchema>;

export const interviewUpdateSchema = z
  .object({
    title: z.string().trim().max(200),
    scheduledStartsAt: z.string().datetime(),
    durationMinutes: z.number().int().min(10).max(240),
    questionSlug: z.string().trim().min(1).max(200).nullable(),
  })
  .partial();
export type InterviewUpdateInput = z.infer<typeof interviewUpdateSchema>;

/** `POST /interviews/:id/end` — optionally save the final shared-editor content. */
export const interviewEndSchema = z.object({
  codeSnapshot: z.string().max(CODE_MAX_LENGTH).optional(),
});
export type InterviewEndInput = z.infer<typeof interviewEndSchema>;

/** `POST /interviews/:id/feedback` — private interviewer feedback. */
export const feedbackCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  notes: z.string().trim().min(1).max(FEEDBACK_NOTES_MAX),
  recommendation: z.enum(FEEDBACK_RECOMMENDATIONS),
  /** Optionally advance the linked application to this status (legal transition only). */
  advanceApplicationTo: z.enum(['SHORTLISTED', 'OFFERED', 'REJECTED']).optional(),
});
export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;

/**
 * `POST /interviews/:id/question` — the interviewer pins a question from the Code
 * Nexus question bank onto the LIVE room (or clears it with `null`). It persists
 * on the interview and is pushed to every participant over the gateway.
 */
export const interviewQuestionSetSchema = z.object({
  slug: z.string().trim().min(1).max(200).nullable(),
});
export type InterviewQuestionSetInput = z.infer<typeof interviewQuestionSetSchema>;

/** `GET /interviews/:id/question-bank` — interviewer-side search of the bank. */
export const interviewQuestionBankQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  topic: z.enum(TOPICS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type InterviewQuestionBankQuery = z.infer<typeof interviewQuestionBankQuerySchema>;

/** `POST /interviews/:id/run` — reuse the Phase-6 pipeline inside the interview. */
export const interviewRunSchema = z.object({
  language: z.string().min(1),
  sourceCode: z.string().min(1).max(CODE_MAX_LENGTH),
  questionSlug: z.string().trim().min(1).max(200).optional(),
});
export type InterviewRunInput = z.infer<typeof interviewRunSchema>;

// ---- Response DTOs ----------------------------------------------------------

export interface InterviewHostRef {
  kind: InterviewHostKind;
  name: string;
}

/**
 * The question pinned to a live room, statement and all — the candidate has to
 * read and solve it in-room, so unlike the list DTO this carries the full body.
 * Hidden testcases are NEVER serialized (same rule as the arena).
 */
export interface InterviewQuestion {
  slug: string;
  title: string;
  difficulty: Difficulty;
  topic: Topic;
  description: string;
  constraints: string | null;
  starterCode: Partial<Record<ProgrammingLanguage, string>> | null;
  sampleTestCases: SampleTestCase[];
}

/** A row in the interviewer's question-bank picker. */
export interface InterviewQuestionBankItem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  topic: Topic;
}

export interface InterviewQuestionBankResponse {
  items: InterviewQuestionBankItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface InterviewPersonRef {
  publicId: string; // user publicId
  displayName: string;
  role: ParticipantRole;
}

export interface InterviewListItem {
  publicId: string;
  title: string | null;
  status: InterviewStatus;
  scheduledStartsAt: string; // ISO
  durationMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  host: InterviewHostRef;
  candidate: { studentPublicId: string; displayName: string };
  canManage: boolean; // the caller hosts / interviews
}

export interface InterviewListResponse {
  interviews: InterviewListItem[];
}

export interface FeedbackDto {
  publicId: string;
  authorName: string;
  rating: number;
  notes: string;
  recommendation: FeedbackRecommendation;
  submittedAt: string; // ISO
}

export interface InterviewDetail {
  publicId: string;
  title: string | null;
  status: InterviewStatus;
  scheduledStartsAt: string; // ISO
  durationMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  host: InterviewHostRef;
  candidate: { studentPublicId: string; displayName: string };
  participants: InterviewPersonRef[];
  canManage: boolean; // host / interviewer
  isCandidate: boolean; // the caller is the candidate
  question: { slug: string; title: string } | null;
  /** The pinned question in full — what the room renders. Null when none is set. */
  activeQuestion: InterviewQuestion | null;
  codeSnapshot: string | null;
  /** Present ONLY for host/admin — NEVER for the candidate. */
  feedback?: FeedbackDto[];
}

/** `GET /interviews/:id/rtc-config` — ICE servers for authorized participants. */
export interface RtcConfigResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

// ---- WSS event contract (client <-> gateway) — interview rooms ---------------
//
// Wire format matches Phase 8: JSON `{ "t": <type>, ... }`. `rtc:*` frames are
// DIRECTED (carry `to`/`from` peer ids); code/whiteboard/chat broadcast.

/** Inbound (client → gateway). */
export const interviewClientMessageSchema = z.discriminatedUnion('t', [
  // Admission control. Only an interviewer may send these; the gateway checks.
  z.object({ t: z.literal('lobby:admit'), peerId: z.string().min(1).max(64) }),
  z.object({ t: z.literal('lobby:deny'), peerId: z.string().min(1).max(64) }),
  z.object({ t: z.literal('rtc:offer'), to: z.string(), sdp: z.string() }),
  z.object({ t: z.literal('rtc:answer'), to: z.string(), sdp: z.string() }),
  z.object({ t: z.literal('rtc:ice'), to: z.string(), candidate: z.unknown() }),
  z.object({ t: z.literal('code:update'), content: z.string().max(CODE_MAX_LENGTH) }),
  z.object({ t: z.literal('whiteboard:stroke'), stroke: z.unknown() }),
  z.object({ t: z.literal('chat:send'), body: z.string().trim().min(1).max(INTERVIEW_CHAT_MAX) }),
  // Switch the room's shared stage for EVERYONE (call / whiteboard / IDE).
  z.object({ t: z.literal('surface:set'), surface: z.enum(INTERVIEW_SURFACES) }),
  z.object({ t: z.literal('presence:heartbeat') }),
]);
export type InterviewClientMessage = z.infer<typeof interviewClientMessageSchema>;

export interface InterviewPeer {
  peerId: string;
  displayName: string;
  role: 'HOST' | 'VIEWER' | 'INTERVIEWER' | 'CANDIDATE';
}

export interface InterviewChatMessage {
  senderName: string;
  senderPublicId: string;
  body: string;
  sentAt: string; // ISO
}

/** Somebody knocking at the door, as shown to the interviewers who can open it. */
export interface LobbyWaiter {
  peerId: string;
  displayName: string;
  requestedAt: string; // ISO
}

/** Outbound (gateway → client). */
export type InterviewServerMessage =
  // ---- Lobby. A candidate's socket is connected but OUTSIDE the room: they
  // receive no roster, no signaling, no chat, and nobody in the room receives
  // anything of theirs until an interviewer admits them.
  | { t: 'lobby:waiting' }
  | { t: 'lobby:updated'; waiting: LobbyWaiter[] }
  | { t: 'lobby:admitted' }
  | { t: 'lobby:denied' }
  | { t: 'ready'; peerId: string; role: InterviewPeer['role']; peers: InterviewPeer[] }
  | { t: 'peer:joined'; peer: InterviewPeer }
  | { t: 'peer:left'; peerId: string }
  | { t: 'rtc:offer'; from: string; sdp: string }
  | { t: 'rtc:answer'; from: string; sdp: string }
  | { t: 'rtc:ice'; from: string; candidate: unknown }
  | { t: 'code:sync'; content: string }
  | { t: 'code:update'; from: string; content: string }
  | { t: 'whiteboard:stroke'; from: string; stroke: unknown }
  | { t: 'chat:new'; message: InterviewChatMessage }
  | { t: 'surface:changed'; surface: InterviewSurface; by: string }
  | { t: 'question:set'; question: InterviewQuestion | null }
  | { t: 'presence:count'; count: number }
  | { t: 'interview:ended' }
  | { t: 'error'; code: string; message: string };

/** The pub/sub channel a room's api-originated events are published on. */
export function interviewChannel(interviewId: string): string {
  return `interview:${interviewId}`;
}

/**
 * Api → gateway events (relayed to the room verbatim — each is a subset of the
 * server contract above, so the gateway never has to translate).
 */
export type InterviewBusEvent =
  { t: 'interview:ended' } | { t: 'question:set'; question: InterviewQuestion | null };

// ---- Pure WebRTC offerer election (unit-tested; used by web + gateway) -------

/**
 * Glare avoidance for a mesh: for any pair of peers, EXACTLY ONE initiates the
 * offer. Rule: the lexicographically smaller peerId offers. Deterministic and
 * order-independent, so a peer can decide locally per pair.
 */
export function isOfferer(selfPeerId: string, otherPeerId: string): boolean {
  return selfPeerId < otherPeerId;
}

// ---- Pure in-room capability rules (enforced at the gateway, mirrored in UI) --

/**
 * The shared IDE is the CANDIDATE's alone — interviewers watch their keystrokes
 * live but cannot type into it (a read-only observer, like a real screen-share of
 * an editor). Enforced server-side at the gateway; the web client only mirrors it
 * by rendering Monaco read-only, which is a hint, not the boundary.
 */
export function canEditSharedCode(role: RtRole): boolean {
  return role === 'CANDIDATE';
}

/**
 * The whiteboard is COLLABORATIVE — both the candidate and the interviewers draw
 * on it. Kept as an explicit rule so the asymmetry with the IDE is deliberate and
 * testable rather than an accident of omission.
 */
export function canDrawOnWhiteboard(_role: RtRole): boolean {
  return true;
}

/**
 * Who has to wait at the door.
 *
 * A candidate never lands straight in the room: they connect, park in the lobby,
 * and an interviewer lets them in. This is not decoration — an interview room can
 * be open early, hold a panel's private discussion between candidates, or simply
 * not be ready, and none of that should be audible to the person waiting.
 *
 * Interviewers admit themselves. The rule is enforced at the gateway (a waiting
 * socket is refused every in-room frame); the web client only mirrors it.
 */
export function needsAdmission(role: RtRole): boolean {
  return role === 'CANDIDATE';
}

/**
 * Who may open the door. Deliberately the complement of `needsAdmission` rather
 * than a second independent list — "waits to be let in" and "can let others in"
 * must never both be true for one role.
 */
export function canAdmitToRoom(role: RtRole): boolean {
  return !needsAdmission(role);
}

/**
 * Anyone in the room may switch the shared surface — a candidate reaching for the
 * whiteboard mid-answer is the point, not a privilege. (Pinning a QUESTION is
 * interviewer-only, but that runs through the api, not this socket.)
 */
export function canSwitchSurface(_role: RtRole): boolean {
  return true;
}

// ---- App-status helper (feedback → application advance) ----------------------

/** The application statuses feedback may advance to (validated against transitions). */
export const FEEDBACK_ADVANCE_TARGETS: readonly ApplicationStatus[] = [
  'SHORTLISTED',
  'OFFERED',
  'REJECTED',
] as const;
