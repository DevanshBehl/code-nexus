import { Prisma, prisma } from '@code-nexus/db';
import type { AppConfig } from '@code-nexus/config';
import {
  canDeleteRecording,
  canViewRecording,
  electRecorder,
  toOffsetMs,
  type InterviewEventDto,
  type InterviewEventKind,
  type RecordingChunkInput,
  type RecordingCompleteInput,
  type RecordingDetail,
  type RecordingListItem,
  type RecordingPlaybackResponse,
  type RecordingStartInput,
  type RecordingViewerContext,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';
import { segmentKey, type RecordingStorage } from './recordings.storage.js';

type Auth = Express.AuthContext;

export interface RecordingCtx {
  config: AppConfig;
  storage: RecordingStorage | null;
}

/**
 * Phase 10 — recording lifecycle, visibility and playback.
 *
 * Every authorization decision here is derived from the session and the
 * interview's own participant/host rows — never from anything the client sends.
 * A caller outside their lane gets 404, not 403: "you may not view this" would
 * still confirm that a particular student interviewed at a particular company.
 */

const interviewForAccess = {
  candidateStudent: {
    select: {
      id: true,
      publicId: true,
      userId: true,
      universityId: true,
      firstName: true,
      lastName: true,
    },
  },
  participants: { select: { userId: true, role: true } },
} satisfies Prisma.InterviewInclude;

type InterviewAccessRow = Prisma.InterviewGetPayload<{ include: typeof interviewForAccess }>;

function candidateName(s: { firstName: string | null; lastName: string | null }): string {
  return [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || 'Student';
}

/**
 * Resolve the caller's relationship to an interview — the raw material the pure
 * `canViewRecording` / `canDeleteRecording` matrix runs on.
 */
function viewerContext(auth: Auth, iv: InterviewAccessRow): RecordingViewerContext {
  return {
    role: auth.role as RecordingViewerContext['role'],
    isCandidate: iv.candidateStudent.userId === auth.userId,
    isAssignedInterviewer: iv.participants.some(
      (p) => p.role === 'INTERVIEWER' && p.userId === auth.userId,
    ),
    hostsAsCompany:
      auth.role === 'COMPANY' && !!auth.companyId && iv.hostCompanyId === auth.companyId,
    hostsAsUniversity:
      auth.role === 'UNIVERSITY' &&
      !!auth.universityId &&
      // A university sees interviews of ITS students, whoever hosted them.
      iv.candidateStudent.universityId === auth.universityId,
  };
}

async function loadInterviewByPublicId(publicId: string): Promise<InterviewAccessRow> {
  const iv = await prisma.interview.findFirst({
    where: { publicId, deletedAt: null },
    include: interviewForAccess,
  });
  if (!iv) throw AppError.notFound('Interview not found');
  return iv;
}

function requireStorage(ctx: RecordingCtx): RecordingStorage {
  if (!ctx.storage) {
    throw AppError.serviceUnavailable('Recording storage is temporarily unavailable');
  }
  return ctx.storage;
}

// ---- Capture ----------------------------------------------------------------

/**
 * Begin capture. Only an ASSIGNED INTERVIEWER of a LIVE interview may record —
 * never the candidate, and never a bystander from the host org who was not put
 * on the call.
 */
export async function startRecording(
  ctx: RecordingCtx,
  auth: Auth,
  interviewPublicId: string,
  input: RecordingStartInput,
): Promise<{ recordingPublicId: string }> {
  requireStorage(ctx);
  const iv = await loadInterviewByPublicId(interviewPublicId);

  const isInterviewer = iv.participants.some(
    (p) => p.role === 'INTERVIEWER' && p.userId === auth.userId,
  );
  if (!isInterviewer) throw AppError.notFound('Interview not found');
  if (iv.status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'Only a live interview can be recorded');
  }
  if (!iv.startedAt) {
    throw new AppError(409, 'CONFLICT', 'The interview has no start time to record against');
  }

  // One recording per interview: a re-elected recorder resumes the SAME record
  // with a fresh segment rather than creating a second, competing one.
  const existing = await prisma.interviewRecording.findUnique({
    where: { interviewId: iv.id },
    select: { publicId: true, status: true },
  });
  if (existing) {
    if (existing.status === 'READY' || existing.status === 'DELETED') {
      throw new AppError(409, 'CONFLICT', 'This interview has already been recorded');
    }
    return { recordingPublicId: existing.publicId };
  }

  const created = await prisma.interviewRecording.create({
    data: {
      interviewId: iv.id,
      status: 'RECORDING',
      mimeType: input.mimeType,
      startedAt: new Date(),
      recordedByUserId: auth.userId,
    },
    select: { publicId: true },
  });
  await logEvent(iv.id, iv.startedAt, 'RECORDING_STARTED', { actorUserId: auth.userId });
  return { recordingPublicId: created.publicId };
}

/**
 * Append one chunk. This is the only path in the platform where media bytes pass
 * through the api, and it is store-and-forward — bounded, rate-limited, and
 * authorized on every single call.
 */
export async function appendChunk(
  ctx: RecordingCtx,
  auth: Auth,
  interviewPublicId: string,
  input: RecordingChunkInput,
  body: Buffer,
): Promise<{ ok: true; totalBytes: number }> {
  const storage = requireStorage(ctx);
  if (body.length === 0) throw new AppError(400, 'VALIDATION', 'Empty chunk');
  if (body.length > ctx.config.RECORDING_MAX_CHUNK_BYTES) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Recording chunk is too large');
  }

  const iv = await loadInterviewByPublicId(interviewPublicId);
  const isInterviewer = iv.participants.some(
    (p) => p.role === 'INTERVIEWER' && p.userId === auth.userId,
  );
  if (!isInterviewer) throw AppError.notFound('Interview not found');

  const recording = await prisma.interviewRecording.findUnique({
    where: { interviewId: iv.id },
    select: { id: true, status: true, totalBytes: true },
  });
  if (!recording) throw AppError.notFound('Recording not found');
  if (recording.status !== 'RECORDING') {
    throw new AppError(409, 'CONFLICT', 'This recording is no longer accepting chunks');
  }
  if (recording.totalBytes + body.length > ctx.config.RECORDING_MAX_TOTAL_BYTES) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Recording has reached its maximum size');
  }

  const key = segmentKey(interviewPublicId, input.ordinal);
  // Storage first: a row pointing at bytes that were never written would make
  // playback fail silently, which is worse than a retryable upload error.
  await storage.put(key, body, 'video/webm');

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.recordingSegment.create({
        data: {
          recordingId: recording.id,
          ordinal: input.ordinal,
          storageKey: key,
          sizeBytes: body.length,
          startOffsetMs: input.startOffsetMs,
          durationMs: input.durationMs ?? null,
        },
      });
      return tx.interviewRecording.update({
        where: { id: recording.id },
        data: { totalBytes: { increment: body.length } },
        select: { totalBytes: true },
      });
    });
    return { ok: true, totalBytes: updated.totalBytes };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // A retry that already landed. Idempotent: the bytes are identical.
      throw new AppError(409, 'CONFLICT', 'That chunk has already been uploaded');
    }
    throw err;
  }
}

/** Finalize capture. Safe to call twice — a second call is a no-op. */
export async function completeRecording(
  auth: Auth,
  interviewPublicId: string,
  input: RecordingCompleteInput,
): Promise<{ ok: true }> {
  const iv = await loadInterviewByPublicId(interviewPublicId);
  const isInterviewer = iv.participants.some(
    (p) => p.role === 'INTERVIEWER' && p.userId === auth.userId,
  );
  if (!isInterviewer) throw AppError.notFound('Interview not found');

  const recording = await prisma.interviewRecording.findUnique({
    where: { interviewId: iv.id },
    select: { id: true, status: true, _count: { select: { segments: true } } },
  });
  if (!recording) throw AppError.notFound('Recording not found');
  if (recording.status !== 'RECORDING') return { ok: true };

  await prisma.interviewRecording.update({
    where: { id: recording.id },
    data: {
      // A recording with no chunks is a failure, not an empty success — say so
      // rather than offering the reviewer a player that can never play.
      status: recording._count.segments > 0 ? 'READY' : 'FAILED',
      endedAt: new Date(),
      durationMs: input.durationMs ?? null,
    },
  });
  await logEvent(iv.id, iv.startedAt, 'RECORDING_STOPPED', { actorUserId: auth.userId });
  return { ok: true };
}

/**
 * Close out a recording left open when the interview ended. Called from the
 * Phase-9 `end` path, because "End for all" is the common way a call finishes —
 * relying on the recorder's browser to finalize would lose recordings routinely.
 */
export async function finalizeOnInterviewEnd(interviewId: string): Promise<void> {
  const rec = await prisma.interviewRecording.findUnique({
    where: { interviewId },
    select: { id: true, status: true, startedAt: true, _count: { select: { segments: true } } },
  });
  if (!rec || rec.status !== 'RECORDING') return;
  const endedAt = new Date();
  await prisma.interviewRecording.update({
    where: { id: rec.id },
    data: {
      status: rec._count.segments > 0 ? 'READY' : 'FAILED',
      endedAt,
      durationMs: endedAt.getTime() - rec.startedAt.getTime(),
    },
  });
}

// ---- Event log --------------------------------------------------------------

/** Write one timeline row, positioned relative to the interview's start. */
export async function logEvent(
  interviewId: string,
  startedAt: Date | null,
  kind: InterviewEventKind,
  opts: { actorUserId?: string | null; label?: string | null; meta?: Prisma.InputJsonValue } = {},
): Promise<void> {
  const offsetMs = toOffsetMs(Date.now(), startedAt);
  // No start time means no timeline to place this on — drop it rather than
  // inventing a position.
  if (offsetMs == null) return;
  await prisma.interviewEvent.create({
    data: {
      interviewId,
      kind,
      offsetMs,
      actorUserId: opts.actorUserId ?? null,
      label: opts.label ?? null,
      ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    },
  });
}

async function listEvents(interviewId: string): Promise<InterviewEventDto[]> {
  const rows = await prisma.interviewEvent.findMany({
    where: { interviewId },
    orderBy: { offsetMs: 'asc' },
    include: { actor: { select: { publicId: true } } },
  });
  return rows.map((e) => ({
    publicId: e.publicId,
    kind: e.kind,
    offsetMs: e.offsetMs,
    label: e.label,
    actorName: e.actor ? `User ${e.actor.publicId.slice(0, 4)}` : null,
  }));
}

/** The timeline for an interview, gated by recording visibility. */
export async function getInterviewEvents(
  auth: Auth,
  interviewPublicId: string,
): Promise<{ events: InterviewEventDto[] }> {
  const iv = await loadInterviewByPublicId(interviewPublicId);
  if (!canViewRecording(viewerContext(auth, iv))) throw AppError.notFound('Interview not found');
  return { events: await listEvents(iv.id) };
}

// ---- Reads ------------------------------------------------------------------

/**
 * List what the caller may see. The where-clause mirrors the pure visibility
 * matrix; both exist so a query bug cannot silently widen access — the row-level
 * check runs again on every detail/playback call.
 */
export async function listRecordings(auth: Auth): Promise<RecordingListItem[]> {
  let where: Prisma.InterviewRecordingWhereInput;
  switch (auth.role) {
    case 'ADMIN':
      where = {};
      break;
    case 'STUDENT':
      where = { interview: { candidateStudent: { userId: auth.userId } } };
      break;
    case 'RECRUITER':
      where = {
        interview: { participants: { some: { userId: auth.userId, role: 'INTERVIEWER' } } },
      };
      break;
    case 'COMPANY':
      where = { interview: { hostCompanyId: auth.companyId ?? '__none__' } };
      break;
    case 'UNIVERSITY':
      where = {
        interview: { candidateStudent: { universityId: auth.universityId ?? '__none__' } },
      };
      break;
    default:
      return [];
  }

  const rows = await prisma.interviewRecording.findMany({
    where: { ...where, deletedAt: null, status: { not: 'DELETED' } },
    include: { interview: { include: interviewForAccess } },
    orderBy: { startedAt: 'desc' },
  });
  return rows.map((r) => ({
    publicId: r.publicId,
    interviewPublicId: r.interview.publicId,
    interviewTitle: r.interview.title,
    candidateName: candidateName(r.interview.candidateStudent),
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    totalBytes: r.totalBytes,
  }));
}

async function loadVisibleRecording(auth: Auth, publicId: string) {
  const rec = await prisma.interviewRecording.findFirst({
    where: { publicId, deletedAt: null },
    include: {
      interview: { include: interviewForAccess },
      segments: { orderBy: { ordinal: 'asc' } },
    },
  });
  if (!rec) throw AppError.notFound('Recording not found');
  const ctx = viewerContext(auth, rec.interview);
  // 404 (not 403) — existence itself is sensitive.
  if (!canViewRecording(ctx)) throw AppError.notFound('Recording not found');
  return { rec, ctx };
}

export async function getRecording(auth: Auth, publicId: string): Promise<RecordingDetail> {
  const { rec, ctx } = await loadVisibleRecording(auth, publicId);
  return {
    publicId: rec.publicId,
    interviewPublicId: rec.interview.publicId,
    interviewTitle: rec.interview.title,
    candidateName: candidateName(rec.interview.candidateStudent),
    status: rec.status,
    startedAt: rec.startedAt.toISOString(),
    endedAt: rec.endedAt?.toISOString() ?? null,
    durationMs: rec.durationMs,
    totalBytes: rec.totalBytes,
    mimeType: rec.mimeType,
    segments: rec.segments.map((s) => ({
      ordinal: s.ordinal,
      sizeBytes: s.sizeBytes,
      durationMs: s.durationMs,
      startOffsetMs: s.startOffsetMs,
    })),
    events: await listEvents(rec.interviewId),
    canDelete: canDeleteRecording(ctx),
  };
}

/**
 * Mint playback URLs and AUDIT the access. Re-checks visibility rather than
 * trusting that the caller reached here via a permitted list.
 */
export async function getPlayback(
  ctx: RecordingCtx,
  auth: Auth,
  publicId: string,
): Promise<RecordingPlaybackResponse> {
  const storage = requireStorage(ctx);
  const { rec } = await loadVisibleRecording(auth, publicId);
  if (rec.status !== 'READY') {
    throw new AppError(409, 'CONFLICT', 'This recording is not ready to play');
  }

  const ttl = ctx.config.RECORDING_URL_TTL_SECONDS;
  const segments = await Promise.all(
    rec.segments.map(async (s) => ({
      ordinal: s.ordinal,
      startOffsetMs: s.startOffsetMs,
      durationMs: s.durationMs,
      // A signed URL when the driver can mint one; otherwise the authenticated
      // api stream route, which re-authorizes on every request.
      url:
        (await storage.signUrl(s.storageKey, ttl)) ??
        `/recordings/${rec.publicId}/stream/${s.ordinal}`,
    })),
  );

  await prisma.recordingAccessLog.create({
    data: { recordingId: rec.id, userId: auth.userId, action: 'view' },
  });

  return { mimeType: rec.mimeType, expiresInSeconds: ttl, segments };
}

/** Resolve one segment's bytes for the `local` driver's streaming route. */
export async function getSegmentForStream(
  ctx: RecordingCtx,
  auth: Auth,
  publicId: string,
  ordinal: number,
): Promise<{ storage: RecordingStorage; storageKey: string; mimeType: string }> {
  const storage = requireStorage(ctx);
  const { rec } = await loadVisibleRecording(auth, publicId);
  const seg = rec.segments.find((s) => s.ordinal === ordinal);
  if (!seg) throw AppError.notFound('Segment not found');
  return { storage, storageKey: seg.storageKey, mimeType: rec.mimeType };
}

// ---- Delete -----------------------------------------------------------------

/**
 * Destroy a recording: the stored objects AND the rows. A recording is personal
 * data, so "delete" must mean the bytes are gone, not merely hidden.
 */
export async function deleteRecording(
  ctx: RecordingCtx,
  auth: Auth,
  publicId: string,
): Promise<{ ok: true }> {
  const { rec, ctx: viewer } = await loadVisibleRecording(auth, publicId);
  if (!canDeleteRecording(viewer)) {
    throw new AppError(403, 'FORBIDDEN', 'You cannot delete this recording');
  }

  if (ctx.storage) {
    for (const s of rec.segments) {
      // Best-effort per object: one missing key must not strand the rest.
      try {
        await ctx.storage.delete(s.storageKey);
      } catch {
        /* already gone */
      }
    }
  }

  await prisma.recordingAccessLog.create({
    data: { recordingId: rec.id, userId: auth.userId, action: 'delete' },
  });
  await prisma.$transaction([
    prisma.recordingSegment.deleteMany({ where: { recordingId: rec.id } }),
    prisma.interviewRecording.update({
      where: { id: rec.id },
      data: { status: 'DELETED', deletedAt: new Date(), totalBytes: 0 },
    }),
  ]);
  return { ok: true };
}

/** Exposed for the room: who should be capturing right now. */
export { electRecorder };
