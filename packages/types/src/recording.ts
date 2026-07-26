import { z } from 'zod';
import type { InterviewPeer, InterviewSurface } from './interview.js';

/**
 * Phase 10 — Interview recording, event timeline & review playback.
 *
 * Phase 9 shipped a peer-to-peer WebRTC mesh with NO SFU, so there is no
 * server-side media stream to capture. Recording therefore happens in ONE
 * elected interviewer's browser (`MediaRecorder`), which uploads finished chunks
 * to the api over ordinary HTTP. That upload is the single, deliberate exception
 * to "no media bytes through the api" — it is store-and-forward, not a live path.
 *
 * This file is the one source of truth shared by the api, the gateway and the web
 * client: DTOs, upload schemas, the event contract, and the pure functions
 * (recorder election, offset math, segment seeking, visibility) that are unit
 * tested without a browser, a database, or object storage.
 */

// ---- Enums (mirror schema.prisma) -------------------------------------------

export const RECORDING_STATUSES = [
  'RECORDING',
  'PROCESSING',
  'READY',
  'FAILED',
  'DELETED',
] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/**
 * What earns a row on the timeline: DELIBERATE ACTS ONLY.
 *
 * There is intentionally no CODE_ACTIVITY / WHITEBOARD_ACTIVITY kind. Continuous
 * typing and drawing are not events — "the candidate was typing" is not a moment
 * a reviewer ever wants to seek to, and logging it 1:1 would bury the handful of
 * marks that actually matter under tens of thousands of rows.
 */
export const INTERVIEW_EVENT_KINDS = [
  'PARTICIPANT_JOINED',
  'PARTICIPANT_LEFT',
  'SURFACE_CHANGED',
  'QUESTION_PINNED',
  'SCREEN_SHARE_STARTED',
  'SCREEN_SHARE_STOPPED',
  'CODE_RUN',
  'RECORDING_STARTED',
  'RECORDING_STOPPED',
] as const;
export type InterviewEventKind = (typeof INTERVIEW_EVENT_KINDS)[number];

/** Human labels for the player's chapter rail. */
export const EVENT_KIND_LABEL: Record<InterviewEventKind, string> = {
  PARTICIPANT_JOINED: 'Joined',
  PARTICIPANT_LEFT: 'Left',
  SURFACE_CHANGED: 'Switched view',
  QUESTION_PINNED: 'Question pinned',
  SCREEN_SHARE_STARTED: 'Screen share started',
  SCREEN_SHARE_STOPPED: 'Screen share stopped',
  CODE_RUN: 'Ran code',
  RECORDING_STARTED: 'Recording started',
  RECORDING_STOPPED: 'Recording stopped',
};

/** Which surface a SURFACE_CHANGED event moved the room to. */
export const SURFACE_LABEL: Record<InterviewSurface, string> = {
  call: 'Video call',
  code: 'Code editor',
  board: 'Whiteboard',
};

// ---- Bounds -----------------------------------------------------------------

/** Upload chunks arrive in strict order; this bounds a pathological ordinal. */
export const MAX_SEGMENT_ORDINAL = 100_000;
export const EVENT_LABEL_MAX = 200;

// ---- Request schemas --------------------------------------------------------

/** `POST /recordings/:interviewPublicId/start` */
export const recordingStartSchema = z.object({
  mimeType: z.string().trim().min(1).max(120),
});
export type RecordingStartInput = z.infer<typeof recordingStartSchema>;

/**
 * `POST /recordings/:interviewPublicId/chunk` — metadata travels as query/header
 * fields because the body is the raw binary blob.
 */
export const recordingChunkSchema = z.object({
  ordinal: z.coerce.number().int().min(0).max(MAX_SEGMENT_ORDINAL),
  /** Offset from Interview.startedAt at which this chunk begins. */
  startOffsetMs: z.coerce.number().int().min(0),
  durationMs: z.coerce.number().int().min(0).optional(),
});
export type RecordingChunkInput = z.infer<typeof recordingChunkSchema>;

/** `POST /recordings/:interviewPublicId/complete` */
export const recordingCompleteSchema = z.object({
  durationMs: z.number().int().min(0).optional(),
});
export type RecordingCompleteInput = z.infer<typeof recordingCompleteSchema>;

// ---- Response DTOs ----------------------------------------------------------

export interface RecordingSegmentDto {
  ordinal: number;
  sizeBytes: number;
  durationMs: number | null;
  startOffsetMs: number;
}

export interface InterviewEventDto {
  publicId: string;
  kind: InterviewEventKind;
  offsetMs: number;
  /** Short display text — a surface name, a question title, a participant. */
  label: string | null;
  actorName: string | null;
}

export interface RecordingListItem {
  publicId: string;
  interviewPublicId: string;
  interviewTitle: string | null;
  candidateName: string;
  status: RecordingStatus;
  startedAt: string; // ISO
  endedAt: string | null;
  durationMs: number | null;
  totalBytes: number;
}

export interface RecordingListResponse {
  recordings: RecordingListItem[];
}

export interface RecordingDetail extends RecordingListItem {
  mimeType: string;
  segments: RecordingSegmentDto[];
  events: InterviewEventDto[];
  /** Whether the caller may delete it (host org / admin). */
  canDelete: boolean;
}

/**
 * `GET /recordings/:publicId/playback` — one entry per segment, in order.
 * `url` is either a short-lived presigned S3 URL or an authenticated api stream
 * route (the `local` driver); the player treats both identically.
 */
export interface RecordingPlaybackResponse {
  mimeType: string;
  expiresInSeconds: number;
  segments: { ordinal: number; url: string; startOffsetMs: number; durationMs: number | null }[];
}

// ---- Pure logic (unit-tested; no browser, no DB, no storage) ----------------

/**
 * Elect exactly ONE recorder for a room.
 *
 * Two recorders would double-upload and corrupt chunk ordering, so the choice
 * must be deterministic and identical on every client without any negotiation.
 * Rule: the INTERVIEWER with the lexicographically smallest peerId — the same
 * order-independent trick `isOfferer` uses for WebRTC glare. The candidate is
 * never eligible: it is not their call to record.
 *
 * Returns null when no interviewer is present, which means "do not record yet".
 */
export function electRecorder(peers: InterviewPeer[]): string | null {
  const eligible = peers
    .filter((p) => p.role === 'INTERVIEWER' || p.role === 'HOST')
    .map((p) => p.peerId)
    .sort();
  return eligible[0] ?? null;
}

/**
 * Convert a wall-clock instant into an offset from the interview's start.
 *
 * Clamped at zero: a frame can legitimately arrive a few ms before `startedAt`
 * is committed, and a negative timestamp would render as a chapter before the
 * video begins. Returns null when the interview never went live — there is no
 * timeline to place anything on.
 */
export function toOffsetMs(at: Date | number, startedAt: Date | number | null): number | null {
  if (startedAt == null) return null;
  const start = startedAt instanceof Date ? startedAt.getTime() : startedAt;
  const t = at instanceof Date ? at.getTime() : at;
  return Math.max(0, Math.round(t - start));
}

/**
 * Decide whether an inbound room frame deserves a timeline row.
 *
 * The allow-list is deliberate: continuous surfaces (`code:update`,
 * `whiteboard:stroke`) and ephemeral chat are excluded by design, not oversight.
 * Keeping this as a pure predicate means the "no keystroke rows" rule is a
 * tested guarantee rather than a comment someone can quietly regress.
 */
export function isLoggableFrame(frameType: string): boolean {
  return frameType === 'surface:set' || frameType === 'surface:changed';
}

/** A segment as the seek math needs to see it. */
export interface SeekableSegment {
  ordinal: number;
  startOffsetMs: number;
  durationMs: number | null;
}

/**
 * Map a global timeline offset onto (which segment, how far into it).
 *
 * A recording is a SEQUENCE of files — one per recorder session — so seeking to
 * "12:30 into the interview" means picking the segment covering that instant and
 * then seeking locally within it. Getting this wrong is the easiest way to ship a
 * player whose chapters jump to the wrong moment, which is why it is pure and
 * tested rather than inlined into a click handler.
 *
 * Offsets before the first segment clamp to its start; offsets past the end land
 * at the end of the last segment. Returns null only when there are no segments.
 */
export function locateOffset(
  segments: SeekableSegment[],
  offsetMs: number,
): { ordinal: number; localOffsetMs: number } | null {
  if (segments.length === 0) return null;
  const ordered = [...segments].sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  const target = Math.max(0, offsetMs);

  // Before the recording began — clamp to the very start.
  const first = ordered[0]!;
  if (target <= first.startOffsetMs) return { ordinal: first.ordinal, localOffsetMs: 0 };

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const seg = ordered[i]!;
    if (target < seg.startOffsetMs) continue;
    const local = target - seg.startOffsetMs;
    // Past this segment's end means the target sits in the dead air before the
    // next one began (the recorder dropped and restarted) or beyond the whole
    // recording. Either way the honest answer is this segment's final frame —
    // never a silent fall-through to an earlier segment, which would seek the
    // player somewhere the reviewer did not ask to go.
    if (seg.durationMs != null && local > seg.durationMs) {
      return { ordinal: seg.ordinal, localOffsetMs: seg.durationMs };
    }
    return { ordinal: seg.ordinal, localOffsetMs: local };
  }
  return { ordinal: first.ordinal, localOffsetMs: 0 };
}

/** The viewer's relationship to a recording, resolved server-side from the session. */
export interface RecordingViewerContext {
  role: 'STUDENT' | 'RECRUITER' | 'COMPANY' | 'UNIVERSITY' | 'ADMIN';
  /** True when the viewer is the interview's candidate. */
  isCandidate: boolean;
  /** True when the viewer was an assigned interviewer. */
  isAssignedInterviewer: boolean;
  /** True when the viewer's company hosted the interview. */
  hostsAsCompany: boolean;
  /** True when the candidate is a student of the viewer's university. */
  hostsAsUniversity: boolean;
}

/**
 * The recording-visibility matrix — the most security-sensitive rule in the
 * platform, because a recording is video of a real person.
 *
 * A caller who fails this must get 404, never 403: "you may not see this" still
 * confirms the interview happened. Every field above is derived from the session
 * server-side; none of it is client-supplied.
 */
export function canViewRecording(ctx: RecordingViewerContext): boolean {
  switch (ctx.role) {
    case 'ADMIN':
      return true;
    case 'STUDENT':
      return ctx.isCandidate;
    case 'RECRUITER':
      return ctx.isAssignedInterviewer;
    case 'COMPANY':
      return ctx.hostsAsCompany;
    case 'UNIVERSITY':
      return ctx.hostsAsUniversity;
    default:
      return false;
  }
}

/** Only the hosting org (or an admin) may destroy a recording. */
export function canDeleteRecording(ctx: RecordingViewerContext): boolean {
  return ctx.role === 'ADMIN' || ctx.hostsAsCompany || ctx.hostsAsUniversity;
}

/** `mm:ss` (or `h:mm:ss`) for the chapter rail. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
