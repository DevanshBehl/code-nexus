import { Prisma, prisma } from '@code-nexus/db';
import type { WebinarMessageDto } from '@code-nexus/types';
import type { PendingEvent } from './events.js';

/**
 * DB-backed side effects for the ws-gateway (chat, votes, attendance). Kept apart
 * from the pure room logic in `rooms.ts`. The gateway shares @code-nexus/db with
 * the api; these writes are the room's persistence.
 */

/** Persist a chat message and return the DTO to broadcast. */
export async function persistChat(
  webinarId: string,
  sender: { userId: string; publicId: string; displayName: string },
  body: string,
): Promise<WebinarMessageDto> {
  const row = await prisma.webinarMessage.create({
    data: { webinarId, senderId: sender.userId, body },
  });
  return {
    publicId: row.publicId,
    senderName: sender.displayName,
    senderPublicId: sender.publicId,
    body: row.body,
    sentAt: row.sentAt.toISOString(),
  };
}

export interface VoteResult {
  ok: boolean;
  counts: { optionPublicId: string; count: number }[];
}

/**
 * Record a one-per-voter vote (guarded by the DB unique constraint) and return
 * the poll's aggregate counts. A duplicate vote is ignored (ok:false) but the
 * current counts are still returned so the client can reconcile.
 */
export async function persistVote(
  webinarId: string,
  pollPublicId: string,
  optionPublicId: string,
  voterId: string,
): Promise<VoteResult | null> {
  const poll = await prisma.webinarPoll.findFirst({
    where: { publicId: pollPublicId, webinarId, status: 'OPEN', deletedAt: null },
    include: { options: true },
  });
  if (!poll) return null; // unknown / closed poll, or not this webinar
  const option = poll.options.find((o) => o.publicId === optionPublicId);
  if (!option) return null;

  let ok = true;
  try {
    await prisma.webinarPollVote.create({
      data: { pollId: poll.id, optionId: option.id, voterId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      ok = false; // already voted
    } else {
      throw err;
    }
  }

  const grouped = await prisma.webinarPollVote.groupBy({
    by: ['optionId'],
    where: { pollId: poll.id },
    _count: { _all: true },
  });
  const byOption = new Map(grouped.map((g) => [g.optionId, g._count._all]));
  const counts = poll.options
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((o) => ({ optionPublicId: o.publicId, count: byOption.get(o.id) ?? 0 }));
  return { ok, counts };
}

/** Mark a student present (upsert the attendance row on first join). */
export async function attendanceJoin(webinarId: string, studentId: string): Promise<void> {
  const now = new Date();
  await prisma.webinarAttendance.upsert({
    where: { webinarId_studentId: { webinarId, studentId } },
    create: { webinarId, studentId, firstJoinedAt: now, lastSeenAt: now, present: true },
    update: { present: true, lastSeenAt: now },
  });
}

/** Heartbeat — advance lastSeenAt without changing the accumulated total. */
export async function attendanceHeartbeat(webinarId: string, studentId: string): Promise<void> {
  await prisma.webinarAttendance
    .update({
      where: { webinarId_studentId: { webinarId, studentId } },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => undefined);
}

/** Fold `deltaSeconds` of presence into the total and mark the student absent. */
export async function attendanceLeave(
  webinarId: string,
  studentId: string,
  deltaSeconds: number,
): Promise<void> {
  await prisma.webinarAttendance
    .update({
      where: { webinarId_studentId: { webinarId, studentId } },
      data: {
        present: false,
        lastSeenAt: new Date(),
        attendedSeconds: { increment: Math.max(0, Math.floor(deltaSeconds)) },
      },
    })
    .catch(() => undefined);
}

/** Confirm a webinar is currently LIVE (the gateway only serves live rooms). */
export async function isWebinarLive(webinarId: string): Promise<boolean> {
  const w = await prisma.webinar.findFirst({
    where: { id: webinarId, deletedAt: null },
    select: { status: true },
  });
  return w?.status === 'LIVE';
}

/** Confirm an interview is currently LIVE (the gateway only serves live rooms). */
export async function isInterviewLive(interviewId: string): Promise<boolean> {
  const i = await prisma.interview.findFirst({
    where: { id: interviewId, deletedAt: null },
    select: { status: true },
  });
  return i?.status === 'LIVE';
}

/**
 * When an interview went live — the zero point for every timeline offset
 * (Phase 10). Null if it never started, in which case nothing is logged.
 */
export async function interviewStartedAt(interviewId: string): Promise<Date | null> {
  const i = await prisma.interview.findFirst({
    where: { id: interviewId, deletedAt: null },
    select: { startedAt: true },
  });
  return i?.startedAt ?? null;
}

/**
 * Persist a batch of timeline rows (Phase 10). `createMany` because these arrive
 * batched and none of them needs its generated row back.
 */
export async function persistEvents(events: PendingEvent[]): Promise<void> {
  if (events.length === 0) return;
  await prisma.interviewEvent.createMany({
    data: events.map((e) => ({
      interviewId: e.interviewId,
      kind: e.kind,
      offsetMs: e.offsetMs,
      actorUserId: e.actorUserId,
      label: e.label,
      ...(e.meta ? { meta: e.meta as object } : {}),
    })),
  });
}
