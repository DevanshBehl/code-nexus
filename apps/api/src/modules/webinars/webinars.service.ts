import { Prisma, prisma } from '@code-nexus/db';
import type { AppConfig } from '@code-nexus/config';
import { signRtToken } from '@code-nexus/auth';
import {
  CHAT_HISTORY_LIMIT,
  webinarChannel,
  type AttendanceResponse,
  type AttendanceRow,
  type PollCreateInput,
  type PollDto,
  type RtTokenResponse,
  type WebinarCreateInput,
  type WebinarDetail,
  type WebinarHostRef,
  type WebinarListItem,
  type WebinarMessageDto,
  type WebinarMessagesResponse,
  type WebinarUpdateInput,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';
import type { RoomBus } from '../../deps.js';
import { createMediaProvider } from './webinars.media.js';

type Auth = Express.AuthContext;

/** Ambient services a webinar command may need (media provider + fan-out bus). */
export interface WebinarCtx {
  config: AppConfig;
  roomBus: RoomBus | null;
}

const webinarInclude = {
  hostUniversity: true,
  hostCompany: true,
  targetUniversity: true,
} satisfies Prisma.WebinarInclude;

type WebinarRow = Prisma.WebinarGetPayload<{ include: typeof webinarInclude }>;

function hostRef(w: WebinarRow): WebinarHostRef {
  return {
    kind: w.hostKind,
    name:
      w.hostKind === 'UNIVERSITY' ? (w.hostUniversity?.name ?? '—') : (w.hostCompany?.name ?? '—'),
  };
}

function displayNameOf(s: { firstName: string | null; lastName: string | null }): string {
  return [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || 'Student';
}

async function requireStudent(auth: Auth): Promise<{
  id: string;
  universityId: string;
  firstName: string | null;
  lastName: string | null;
}> {
  const s = await prisma.student.findUnique({
    where: { userId: auth.userId },
    select: { id: true, universityId: true, firstName: true, lastName: true },
  });
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Student profile not found');
  return s;
}

async function resolveUniversityId(publicId: string): Promise<string> {
  const uni = await prisma.university.findFirst({ where: { publicId, deletedAt: null } });
  if (!uni) throw new AppError(404, 'NOT_FOUND', 'Target university not found');
  return uni.id;
}

/** Load a webinar and enforce that `auth` may see it; returns row + canManage. */
async function loadVisibleWebinar(
  auth: Auth,
  publicId: string,
): Promise<{ webinar: WebinarRow; canManage: boolean }> {
  const w = await prisma.webinar.findFirst({
    where: { publicId, deletedAt: null },
    include: webinarInclude,
  });
  if (!w) throw AppError.notFound('Webinar not found');

  const canManage =
    auth.role === 'ADMIN' ||
    (auth.role === 'UNIVERSITY' &&
      w.hostKind === 'UNIVERSITY' &&
      w.hostUniversityId === auth.universityId) ||
    (auth.role === 'COMPANY' && w.hostKind === 'COMPANY' && w.hostCompanyId === auth.companyId);
  if (canManage) return { webinar: w, canManage: true };

  // Students of the target university may see published (non-draft/cancelled) webinars.
  if (auth.role === 'STUDENT') {
    const s = await requireStudent(auth);
    if (
      w.targetUniversityId === s.universityId &&
      w.status !== 'DRAFT' &&
      w.status !== 'CANCELLED'
    ) {
      return { webinar: w, canManage: false };
    }
  }
  throw AppError.notFound('Webinar not found');
}

function requireManage(canManage: boolean): void {
  if (!canManage) throw new AppError(403, 'FORBIDDEN', 'You do not host this webinar');
}

// ---- Mappers ----------------------------------------------------------------

function mapListItem(w: WebinarRow, canManage: boolean): WebinarListItem {
  return {
    publicId: w.publicId,
    title: w.title,
    status: w.status,
    scheduledStartsAt: w.scheduledStartsAt.toISOString(),
    startedAt: w.startedAt?.toISOString() ?? null,
    endedAt: w.endedAt?.toISOString() ?? null,
    host: hostRef(w),
    targetUniversity: { publicId: w.targetUniversity.publicId, name: w.targetUniversity.name },
    canManage,
  };
}

function mapDetail(w: WebinarRow, canManage: boolean, config: AppConfig): WebinarDetail {
  const media = createMediaProvider(config);
  const detail: WebinarDetail = {
    publicId: w.publicId,
    title: w.title,
    description: w.description,
    status: w.status,
    scheduledStartsAt: w.scheduledStartsAt.toISOString(),
    startedAt: w.startedAt?.toISOString() ?? null,
    endedAt: w.endedAt?.toISOString() ?? null,
    host: hostRef(w),
    targetUniversity: { publicId: w.targetUniversity.publicId, name: w.targetUniversity.name },
    canManage,
    // Viewers get the playback URL only; never the stream key.
    playbackUrl: w.status === 'LIVE' ? w.playbackUrl : null,
  };
  // Host-only ingest credentials — NEVER included for a viewer.
  if (canManage) {
    detail.ingest = media.ingestFor(w.streamKey);
  }
  return detail;
}

// ---- Commands ---------------------------------------------------------------

export async function createWebinar(
  ctx: WebinarCtx,
  auth: Auth,
  input: WebinarCreateInput,
): Promise<WebinarDetail> {
  let hostKind: 'UNIVERSITY' | 'COMPANY';
  let hostUniversityId: string | null = null;
  let hostCompanyId: string | null = null;
  let targetUniversityId: string;

  if (auth.role === 'UNIVERSITY') {
    if (!auth.universityId) throw new AppError(403, 'FORBIDDEN', 'No university in scope');
    hostKind = 'UNIVERSITY';
    hostUniversityId = auth.universityId;
    targetUniversityId = input.targetUniversityPublicId
      ? await resolveUniversityId(input.targetUniversityPublicId)
      : auth.universityId;
  } else if (auth.role === 'COMPANY') {
    if (!auth.companyId) throw new AppError(403, 'FORBIDDEN', 'No company in scope');
    if (!input.targetUniversityPublicId) {
      throw new AppError(400, 'VALIDATION', 'A company webinar must target a university');
    }
    hostKind = 'COMPANY';
    hostCompanyId = auth.companyId;
    targetUniversityId = await resolveUniversityId(input.targetUniversityPublicId);
  } else {
    // ADMIN acts as a university host of the target university.
    if (!input.targetUniversityPublicId) {
      throw new AppError(400, 'VALIDATION', 'Select a target university');
    }
    hostKind = 'UNIVERSITY';
    targetUniversityId = await resolveUniversityId(input.targetUniversityPublicId);
    hostUniversityId = targetUniversityId;
  }

  const w = await prisma.webinar.create({
    data: {
      title: input.title,
      description: input.description,
      hostKind,
      hostUniversityId,
      hostCompanyId,
      targetUniversityId,
      scheduledStartsAt: new Date(input.scheduledStartsAt),
      status: 'DRAFT',
      createdById: auth.userId,
    },
    include: webinarInclude,
  });
  return mapDetail(w, true, ctx.config);
}

export async function updateWebinar(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
  input: WebinarUpdateInput,
): Promise<WebinarDetail> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage);
  if (webinar.status !== 'DRAFT' && webinar.status !== 'SCHEDULED') {
    throw new AppError(409, 'CONFLICT', 'A webinar can only be edited before it goes live');
  }
  const data: Prisma.WebinarUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.scheduledStartsAt !== undefined) {
    data.scheduledStartsAt = new Date(input.scheduledStartsAt);
  }
  const updated = await prisma.webinar.update({
    where: { id: webinar.id },
    data,
    include: webinarInclude,
  });
  return mapDetail(updated, true, ctx.config);
}

export async function publishWebinar(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
): Promise<WebinarDetail> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage);
  if (webinar.status !== 'DRAFT') {
    throw new AppError(409, 'CONFLICT', 'Only a draft webinar can be published');
  }
  const updated = await prisma.webinar.update({
    where: { id: webinar.id },
    data: { status: 'SCHEDULED' },
    include: webinarInclude,
  });
  return mapDetail(updated, true, ctx.config);
}

export async function cancelWebinar(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
): Promise<WebinarDetail> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage);
  if (webinar.status !== 'DRAFT' && webinar.status !== 'SCHEDULED') {
    throw new AppError(409, 'CONFLICT', 'Only a draft or scheduled webinar can be cancelled');
  }
  const updated = await prisma.webinar.update({
    where: { id: webinar.id },
    data: { status: 'CANCELLED' },
    include: webinarInclude,
  });
  return mapDetail(updated, true, ctx.config);
}

/** Go live — provision media (compute the playback URL) and open the room. */
export async function goLiveWebinar(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
): Promise<WebinarDetail> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage);
  if (webinar.status !== 'SCHEDULED') {
    throw new AppError(409, 'CONFLICT', 'Only a scheduled webinar can go live');
  }
  const media = createMediaProvider(ctx.config);
  const updated = await prisma.webinar.update({
    where: { id: webinar.id },
    data: {
      status: 'LIVE',
      startedAt: new Date(),
      playbackUrl: media.playbackUrlFor(webinar.streamKey),
    },
    include: webinarInclude,
  });
  return mapDetail(updated, true, ctx.config);
}

/** End the webinar — freeze the room and tell every socket to close. */
export async function endWebinar(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
): Promise<WebinarDetail> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage);
  if (webinar.status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'Only a live webinar can be ended');
  }
  const updated = await prisma.webinar.update({
    where: { id: webinar.id },
    data: { status: 'ENDED', endedAt: new Date() },
    include: webinarInclude,
  });
  await ctx.roomBus?.publish(webinarChannel(webinar.id), { t: 'webinar:ended' });
  return mapDetail(updated, true, ctx.config);
}

// ---- RT token ---------------------------------------------------------------

/**
 * Mint a short-lived token authorizing the caller to open the webinar's socket.
 * Only the host or an eligible target-university student of a LIVE webinar may
 * obtain one — the gateway re-checks the signature + expiry, never the session.
 */
export async function mintRtToken(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
): Promise<RtTokenResponse> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  if (webinar.status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'The webinar is not live');
  }

  let role: 'HOST' | 'VIEWER';
  let displayName: string;
  let studentId: string | undefined;
  if (canManage) {
    role = 'HOST';
    displayName = hostRef(webinar).name;
  } else {
    const s = await requireStudent(auth);
    if (webinar.targetUniversityId !== s.universityId) {
      throw new AppError(403, 'NOT_ELIGIBLE', 'This webinar is not open to your university');
    }
    role = 'VIEWER';
    displayName = displayNameOf(s);
    studentId = s.id;
  }

  const { token, exp } = signRtToken(
    {
      kind: 'webinar',
      roomId: webinar.id,
      roomPublicId: webinar.publicId,
      userId: auth.userId,
      publicId: auth.publicId,
      role,
      displayName,
      ...(studentId ? { studentId } : {}),
    },
    ctx.config.RT_TOKEN_SECRET,
    ctx.config.RT_TOKEN_TTL_SECONDS,
  );
  return {
    token,
    url: ctx.config.WS_GATEWAY_PUBLIC_URL,
    expiresIn: exp - Math.floor(Date.now() / 1000),
  };
}

// ---- Chat history -----------------------------------------------------------

export async function listMessages(
  auth: Auth,
  publicId: string,
  limit: number,
): Promise<WebinarMessagesResponse> {
  const { webinar } = await loadVisibleWebinar(auth, publicId);
  const rows = await prisma.webinarMessage.findMany({
    where: { webinarId: webinar.id, deletedAt: null },
    include: { sender: { select: { publicId: true } } },
    orderBy: { sentAt: 'desc' },
    take: Math.min(limit, CHAT_HISTORY_LIMIT),
  });
  // TODO(phaseN): resolve richer sender display names (join student/recruiter).
  const messages: WebinarMessageDto[] = rows.reverse().map((m) => ({
    publicId: m.publicId,
    senderName: senderNameFallback(m.sender.publicId),
    senderPublicId: m.sender.publicId,
    body: m.body,
    sentAt: m.sentAt.toISOString(),
  }));
  return { messages };
}

function senderNameFallback(publicId: string): string {
  // The gateway persists the display name into the live frame; history uses a
  // stable fallback so no PII beyond the publicId is joined here.
  return `Participant ${publicId.slice(0, 4)}`;
}

// ---- Polls ------------------------------------------------------------------

function mapPoll(
  poll: Prisma.WebinarPollGetPayload<{ include: { options: true; votes: true } }>,
  myUserId?: string,
): PollDto {
  const counts = new Map<string, number>();
  let myVote: string | null = null;
  for (const v of poll.votes) {
    counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
    if (myUserId && v.voterId === myUserId) myVote = v.optionId;
  }
  const options = [...poll.options]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((o) => ({
      publicId: o.publicId,
      text: o.text,
      ordinal: o.ordinal,
      count: counts.get(o.id) ?? 0,
    }));
  const myVoteOption = myVote ? poll.options.find((o) => o.id === myVote) : undefined;
  return {
    publicId: poll.publicId,
    question: poll.question,
    status: poll.status,
    options,
    ...(myUserId ? { myVoteOptionPublicId: myVoteOption?.publicId ?? null } : {}),
  };
}

export async function createPoll(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
  input: PollCreateInput,
): Promise<PollDto> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage);
  if (webinar.status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'Polls can only be opened during a live webinar');
  }
  const poll = await prisma.webinarPoll.create({
    data: {
      webinarId: webinar.id,
      question: input.question,
      status: 'OPEN',
      options: { create: input.options.map((text, i) => ({ text, ordinal: i + 1 })) },
    },
    include: { options: true, votes: true },
  });
  const dto = mapPoll(poll);
  await ctx.roomBus?.publish(webinarChannel(webinar.id), { t: 'poll:opened', poll: dto });
  return dto;
}

export async function closePoll(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
  pollPublicId: string,
): Promise<PollDto> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage);
  const poll = await prisma.webinarPoll.findFirst({
    where: { publicId: pollPublicId, webinarId: webinar.id, deletedAt: null },
    include: { options: true, votes: true },
  });
  if (!poll) throw AppError.notFound('Poll not found');
  if (poll.status === 'CLOSED') return mapPoll(poll);
  const updated = await prisma.webinarPoll.update({
    where: { id: poll.id },
    data: { status: 'CLOSED', closedAt: new Date() },
    include: { options: true, votes: true },
  });
  await ctx.roomBus?.publish(webinarChannel(webinar.id), {
    t: 'poll:closed',
    pollId: poll.publicId,
  });
  return mapPoll(updated);
}

export async function listPolls(auth: Auth, publicId: string): Promise<{ polls: PollDto[] }> {
  const { webinar } = await loadVisibleWebinar(auth, publicId);
  const polls = await prisma.webinarPoll.findMany({
    where: { webinarId: webinar.id, deletedAt: null },
    include: { options: true, votes: true },
    orderBy: { openedAt: 'asc' },
  });
  return { polls: polls.map((p) => mapPoll(p, auth.userId)) };
}

// ---- Attendance -------------------------------------------------------------

export async function getAttendance(auth: Auth, publicId: string): Promise<AttendanceResponse> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  requireManage(canManage); // host only — no student sees another's attendance
  const rows = await prisma.webinarAttendance.findMany({
    where: { webinarId: webinar.id },
    include: { student: { select: { publicId: true, firstName: true, lastName: true } } },
    orderBy: { firstJoinedAt: 'asc' },
  });
  const attendance: AttendanceRow[] = rows.map((r) => ({
    studentPublicId: r.student.publicId,
    displayName: displayNameOf(r.student),
    firstJoinedAt: r.firstJoinedAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    attendedSeconds: r.attendedSeconds,
    present: r.present,
  }));
  return { attendance };
}

// ---- Queries ----------------------------------------------------------------

export async function listWebinars(auth: Auth): Promise<WebinarListItem[]> {
  if (auth.role === 'UNIVERSITY') {
    const rows = await prisma.webinar.findMany({
      where: {
        hostKind: 'UNIVERSITY',
        hostUniversityId: auth.universityId ?? '__none__',
        deletedAt: null,
      },
      include: webinarInclude,
      orderBy: { scheduledStartsAt: 'desc' },
    });
    return rows.map((w) => mapListItem(w, true));
  }
  if (auth.role === 'COMPANY') {
    const rows = await prisma.webinar.findMany({
      where: { hostKind: 'COMPANY', hostCompanyId: auth.companyId ?? '__none__', deletedAt: null },
      include: webinarInclude,
      orderBy: { scheduledStartsAt: 'desc' },
    });
    return rows.map((w) => mapListItem(w, true));
  }
  if (auth.role === 'ADMIN') {
    const rows = await prisma.webinar.findMany({
      where: { deletedAt: null },
      include: webinarInclude,
      orderBy: { scheduledStartsAt: 'desc' },
    });
    return rows.map((w) => mapListItem(w, true));
  }
  // STUDENT — published webinars targeting their university.
  const student = await requireStudent(auth);
  const rows = await prisma.webinar.findMany({
    where: {
      targetUniversityId: student.universityId,
      status: { in: ['SCHEDULED', 'LIVE', 'ENDED'] },
      deletedAt: null,
    },
    include: webinarInclude,
    orderBy: { scheduledStartsAt: 'desc' },
  });
  return rows.map((w) => mapListItem(w, false));
}

export async function getWebinar(
  ctx: WebinarCtx,
  auth: Auth,
  publicId: string,
): Promise<WebinarDetail> {
  const { webinar, canManage } = await loadVisibleWebinar(auth, publicId);
  return mapDetail(webinar, canManage, ctx.config);
}
