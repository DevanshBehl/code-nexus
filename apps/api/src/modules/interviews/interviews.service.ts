import { Prisma, prisma } from '@code-nexus/db';
import type { AppConfig } from '@code-nexus/config';
import type { Publisher } from '@code-nexus/mq';
import { signRtToken } from '@code-nexus/auth';
import {
  canCompanyTransition,
  interviewChannel,
  type FeedbackCreateInput,
  type FeedbackDto,
  type InterviewCreateInput,
  type InterviewDetail,
  type InterviewEndInput,
  type InterviewHostRef,
  type InterviewListItem,
  type InterviewPersonRef,
  type InterviewQuestion,
  type InterviewQuestionBankQuery,
  type InterviewQuestionBankResponse,
  type InterviewQuestionSetInput,
  type InterviewRunInput,
  type InterviewUpdateInput,
  type RtcConfigResponse,
  type RtTokenResponse,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';
import type { RoomBus } from '../../deps.js';
import { finalizeOnInterviewEnd, logEvent } from '../recordings/recordings.service.js';

type Auth = Express.AuthContext;

/** Ambient services an interview command may need. */
export interface InterviewCtx {
  config: AppConfig;
  roomBus: RoomBus | null;
  publisher?: Publisher | null;
}

const interviewInclude = {
  hostUniversity: true,
  hostCompany: true,
  candidateStudent: {
    select: { id: true, publicId: true, userId: true, firstName: true, lastName: true },
  },
  // The pinned question is rendered inside the room, statement and all — but only
  // SAMPLE testcases are ever included (hidden ones never leave the server).
  question: {
    include: {
      testCases: { where: { isSample: true, deletedAt: null }, orderBy: { ordinal: 'asc' } },
    },
  },
  participants: {
    include: { user: { select: { publicId: true } } },
  },
} satisfies Prisma.InterviewInclude;

type InterviewRow = Prisma.InterviewGetPayload<{ include: typeof interviewInclude }>;

function studentName(s: { firstName: string | null; lastName: string | null }): string {
  return [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || 'Student';
}

/** The pinned question as the room renders it — sample testcases only. */
function questionRef(q: InterviewRow['question']): InterviewQuestion | null {
  if (!q) return null;
  return {
    slug: q.slug,
    title: q.title,
    difficulty: q.difficulty,
    topic: q.topic,
    description: q.description,
    constraints: q.constraints,
    starterCode: (q.starterCode as InterviewQuestion['starterCode']) ?? null,
    sampleTestCases: q.testCases.map((t) => ({
      input: t.input,
      expectedOutput: t.expectedOutput,
    })),
  };
}

function hostRef(i: InterviewRow): InterviewHostRef {
  return {
    kind: i.hostKind,
    name:
      i.hostKind === 'UNIVERSITY' ? (i.hostUniversity?.name ?? '—') : (i.hostCompany?.name ?? '—'),
  };
}

/** The caller's relationship to an interview. */
interface Access {
  interview: InterviewRow;
  canManage: boolean; // host org OR an interviewer participant
  isCandidate: boolean;
  isParticipant: boolean;
}

async function requireStudentId(auth: Auth): Promise<string> {
  const s = await prisma.student.findUnique({
    where: { userId: auth.userId },
    select: { id: true },
  });
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Student profile not found');
  return s.id;
}

/** Load an interview and enforce that `auth` may see it. */
async function loadVisibleInterview(auth: Auth, publicId: string): Promise<Access> {
  const i = await prisma.interview.findFirst({
    where: { publicId, deletedAt: null },
    include: interviewInclude,
  });
  if (!i) throw AppError.notFound('Interview not found');

  const hostsIt =
    auth.role === 'ADMIN' ||
    (auth.role === 'UNIVERSITY' &&
      i.hostKind === 'UNIVERSITY' &&
      i.hostUniversityId === auth.universityId) ||
    (auth.role === 'COMPANY' && i.hostKind === 'COMPANY' && i.hostCompanyId === auth.companyId);

  const isInterviewerParticipant = i.participants.some(
    (p) => p.role === 'INTERVIEWER' && p.userId === auth.userId,
  );
  const isCandidate = i.candidateStudent.userId === auth.userId;

  const canManage = hostsIt || isInterviewerParticipant;
  const isParticipant = canManage || isCandidate;
  if (isParticipant) return { interview: i, canManage, isCandidate, isParticipant };
  throw AppError.notFound('Interview not found');
}

function requireManage(canManage: boolean): void {
  if (!canManage) throw new AppError(403, 'FORBIDDEN', 'You do not host this interview');
}

// ---- Mappers ----------------------------------------------------------------

function participantRefs(i: InterviewRow): InterviewPersonRef[] {
  return i.participants.map((p) => ({
    publicId: p.user.publicId,
    displayName:
      p.role === 'CANDIDATE'
        ? studentName(i.candidateStudent)
        : (i.hostCompany?.name ?? i.hostUniversity?.name ?? 'Interviewer'),
    role: p.role,
  }));
}

function mapListItem(i: InterviewRow, canManage: boolean): InterviewListItem {
  return {
    publicId: i.publicId,
    title: i.title,
    status: i.status,
    scheduledStartsAt: i.scheduledStartsAt.toISOString(),
    durationMinutes: i.durationMinutes,
    startedAt: i.startedAt?.toISOString() ?? null,
    endedAt: i.endedAt?.toISOString() ?? null,
    host: hostRef(i),
    candidate: {
      studentPublicId: i.candidateStudent.publicId,
      displayName: studentName(i.candidateStudent),
    },
    canManage,
  };
}

async function mapDetail(i: InterviewRow, access: Access): Promise<InterviewDetail> {
  const detail: InterviewDetail = {
    publicId: i.publicId,
    title: i.title,
    status: i.status,
    scheduledStartsAt: i.scheduledStartsAt.toISOString(),
    durationMinutes: i.durationMinutes,
    startedAt: i.startedAt?.toISOString() ?? null,
    endedAt: i.endedAt?.toISOString() ?? null,
    host: hostRef(i),
    candidate: {
      studentPublicId: i.candidateStudent.publicId,
      displayName: studentName(i.candidateStudent),
    },
    participants: participantRefs(i),
    canManage: access.canManage,
    isCandidate: access.isCandidate,
    question: i.question ? { slug: i.question.slug, title: i.question.title } : null,
    activeQuestion: questionRef(i.question),
    codeSnapshot: i.codeSnapshot,
  };
  // Feedback is private — host/admin (canManage) only, NEVER the candidate.
  if (access.canManage) {
    detail.feedback = await listFeedback(i.id);
  }
  return detail;
}

// ---- Commands ---------------------------------------------------------------

export async function createInterview(
  ctx: InterviewCtx,
  auth: Auth,
  input: InterviewCreateInput,
): Promise<InterviewDetail> {
  // Resolve host scope.
  let hostKind: 'UNIVERSITY' | 'COMPANY';
  let hostUniversityId: string | null = null;
  let hostCompanyId: string | null = null;
  if (auth.role === 'COMPANY') {
    if (!auth.companyId) throw new AppError(403, 'FORBIDDEN', 'No company in scope');
    hostKind = 'COMPANY';
    hostCompanyId = auth.companyId;
  } else if (auth.role === 'UNIVERSITY') {
    if (!auth.universityId) throw new AppError(403, 'FORBIDDEN', 'No university in scope');
    hostKind = 'UNIVERSITY';
    hostUniversityId = auth.universityId;
  } else {
    throw new AppError(403, 'FORBIDDEN', 'Only a company or university can schedule interviews');
  }

  const candidate = await prisma.student.findFirst({
    where: { publicId: input.candidateStudentPublicId, deletedAt: null },
    select: { id: true, userId: true },
  });
  if (!candidate) throw AppError.notFound('Candidate student not found');

  // Optional linkage validation.
  let applicationId: string | null = null;
  if (input.applicationPublicId) {
    const app = await prisma.application.findFirst({
      where: { publicId: input.applicationPublicId, studentId: candidate.id, deletedAt: null },
      include: { drive: true },
    });
    if (!app) throw AppError.notFound('Linked application not found for this candidate');
    // A company may only link its own drive's application.
    if (hostKind === 'COMPANY' && app.drive.companyId !== hostCompanyId) {
      throw new AppError(403, 'FORBIDDEN', 'That application belongs to another company');
    }
    applicationId = app.id;
  }

  let questionId: string | null = null;
  if (input.questionSlug) {
    const q = await prisma.question.findFirst({
      where: { slug: input.questionSlug, deletedAt: null },
      select: { id: true },
    });
    if (!q) throw AppError.notFound('Coding question not found');
    questionId = q.id;
  }

  // Resolve the assigned interviewers. For a COMPANY host these MUST be its own
  // recruiters (they conduct the interview); the company account is also added so
  // it can join to observe/manage.
  const extraInterviewerUserIds: string[] = [];
  for (const pubId of input.interviewerPublicIds ?? []) {
    const u = await prisma.user.findFirst({
      where: { publicId: pubId },
      select: { id: true, recruiter: { select: { companyId: true } } },
    });
    if (!u) throw AppError.notFound('Interviewer not found');
    if (u.id === auth.userId) continue;
    if (hostKind === 'COMPANY' && u.recruiter?.companyId !== hostCompanyId) {
      throw new AppError(403, 'FORBIDDEN', 'Interviewers must be recruiters of your company');
    }
    extraInterviewerUserIds.push(u.id);
  }

  const interviewerIds = [auth.userId, ...extraInterviewerUserIds];
  const created = await prisma.interview.create({
    data: {
      title: input.title ?? null,
      hostKind,
      hostUniversityId,
      hostCompanyId,
      candidateStudentId: candidate.id,
      scheduledStartsAt: new Date(input.scheduledStartsAt),
      durationMinutes: input.durationMinutes,
      status: 'SCHEDULED',
      applicationId,
      questionId,
      createdById: auth.userId,
      participants: {
        create: [
          { userId: candidate.userId, role: 'CANDIDATE' },
          ...interviewerIds.map((userId) => ({ userId, role: 'INTERVIEWER' as const })),
        ],
      },
    },
    include: interviewInclude,
  });
  return mapDetail(created, {
    interview: created,
    canManage: true,
    isCandidate: false,
    isParticipant: true,
  });
}

export async function updateInterview(
  auth: Auth,
  publicId: string,
  input: InterviewUpdateInput,
): Promise<InterviewDetail> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage);
  if (access.interview.status !== 'SCHEDULED') {
    throw new AppError(409, 'CONFLICT', 'An interview can only be edited before it goes live');
  }
  const data: Prisma.InterviewUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.scheduledStartsAt !== undefined)
    data.scheduledStartsAt = new Date(input.scheduledStartsAt);
  if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
  if (input.questionSlug !== undefined) {
    if (input.questionSlug === null) {
      data.question = { disconnect: true };
    } else {
      const q = await prisma.question.findFirst({
        where: { slug: input.questionSlug, deletedAt: null },
        select: { id: true },
      });
      if (!q) throw AppError.notFound('Coding question not found');
      data.question = { connect: { id: q.id } };
    }
  }
  const updated = await prisma.interview.update({
    where: { id: access.interview.id },
    data,
    include: interviewInclude,
  });
  return mapDetail(updated, { ...access, interview: updated });
}

export async function cancelInterview(auth: Auth, publicId: string): Promise<InterviewDetail> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage);
  if (access.interview.status !== 'SCHEDULED') {
    throw new AppError(409, 'CONFLICT', 'Only a scheduled interview can be cancelled');
  }
  const updated = await prisma.interview.update({
    where: { id: access.interview.id },
    data: { status: 'CANCELLED' },
    include: interviewInclude,
  });
  return mapDetail(updated, { ...access, interview: updated });
}

export async function goLiveInterview(auth: Auth, publicId: string): Promise<InterviewDetail> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage);
  if (access.interview.status !== 'SCHEDULED') {
    throw new AppError(409, 'CONFLICT', 'Only a scheduled interview can go live');
  }
  const updated = await prisma.interview.update({
    where: { id: access.interview.id },
    data: { status: 'LIVE', startedAt: new Date() },
    include: interviewInclude,
  });
  return mapDetail(updated, { ...access, interview: updated });
}

export async function endInterview(
  ctx: InterviewCtx,
  auth: Auth,
  publicId: string,
  input: InterviewEndInput,
): Promise<InterviewDetail> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage);
  if (access.interview.status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'Only a live interview can be ended');
  }
  const updated = await prisma.interview.update({
    where: { id: access.interview.id },
    data: {
      status: 'ENDED',
      endedAt: new Date(),
      ...(input.codeSnapshot !== undefined ? { codeSnapshot: input.codeSnapshot } : {}),
    },
    include: interviewInclude,
  });
  // "End for all" is how a call normally finishes, so the recording must be
  // closed out here — leaving it to the recorder's browser would lose recordings
  // routinely (the tab is usually gone by the time the frame lands).
  await finalizeOnInterviewEnd(updated.id);
  await ctx.roomBus?.publish(interviewChannel(updated.id), { t: 'interview:ended' });
  return mapDetail(updated, { ...access, interview: updated });
}

// ---- Live question bank (interviewer-only) ----------------------------------

/**
 * Search the Code Nexus question bank from inside the room. This deliberately does
 * NOT reuse the arena's `listQuestions`: that one resolves the caller's *student*
 * solve status, and the people browsing here are recruiters who have no student
 * profile at all. Same bank, no per-student decoration.
 */
export async function questionBank(
  auth: Auth,
  publicId: string,
  query: InterviewQuestionBankQuery,
): Promise<InterviewQuestionBankResponse> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage); // the candidate never browses the bank
  const where: Prisma.QuestionWhereInput = {
    published: true,
    deletedAt: null,
    ...(query.topic ? { topic: query.topic } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      orderBy: [{ difficulty: 'asc' }, { title: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { slug: true, title: true, difficulty: true, topic: true },
    }),
  ]);
  return { items: rows, page: query.page, pageSize: query.pageSize, total };
}

/**
 * Pin a question onto the interview (or clear it with `null`). It is persisted on
 * the record AND pushed to everyone in the room over the bus, so the candidate
 * sees the problem the moment the interviewer picks it — no refresh, no re-join.
 */
export async function setInterviewQuestion(
  ctx: InterviewCtx,
  auth: Auth,
  publicId: string,
  input: InterviewQuestionSetInput,
): Promise<{ question: InterviewQuestion | null }> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage); // only an interviewer sets the problem
  const status = access.interview.status;
  if (status !== 'SCHEDULED' && status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'This interview is over');
  }

  let questionId: string | null = null;
  if (input.slug !== null) {
    const q = await prisma.question.findFirst({
      where: { slug: input.slug, published: true, deletedAt: null },
      select: { id: true },
    });
    if (!q) throw AppError.notFound('Coding question not found');
    questionId = q.id;
  }

  const updated = await prisma.interview.update({
    where: { id: access.interview.id },
    data: questionId
      ? { question: { connect: { id: questionId } } }
      : { question: { disconnect: true } },
    include: interviewInclude,
  });
  const question = questionRef(updated.question);
  if (question) {
    await logEvent(updated.id, updated.startedAt, 'QUESTION_PINNED', {
      actorUserId: auth.userId,
      label: question.title,
      meta: { slug: question.slug },
    });
  }
  await ctx.roomBus?.publish(interviewChannel(updated.id), { t: 'question:set', question });
  return { question };
}

// ---- RT token + ICE config --------------------------------------------------

export async function mintRtToken(
  ctx: InterviewCtx,
  auth: Auth,
  publicId: string,
): Promise<RtTokenResponse> {
  const access = await loadVisibleInterview(auth, publicId);
  if (access.interview.status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'The interview is not live');
  }
  const i = access.interview;
  const role = access.isCandidate ? 'CANDIDATE' : 'INTERVIEWER';
  const displayName = access.isCandidate ? studentName(i.candidateStudent) : hostRef(i).name;
  const studentId = access.isCandidate ? i.candidateStudentId : undefined;

  const { token, exp } = signRtToken(
    {
      kind: 'interview',
      roomId: i.id,
      roomPublicId: i.publicId,
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

/** ICE servers for authorized participants. STUN always; TURN only if configured. */
export async function rtcConfig(
  ctx: InterviewCtx,
  auth: Auth,
  publicId: string,
): Promise<RtcConfigResponse> {
  await loadVisibleInterview(auth, publicId); // participant check (throws 404 otherwise)
  const iceServers: RtcConfigResponse['iceServers'] = [{ urls: ctx.config.RTC_STUN_URLS }];
  if (ctx.config.RTC_TURN_URL) {
    iceServers.push({
      urls: ctx.config.RTC_TURN_URL,
      username: ctx.config.RTC_TURN_USERNAME,
      credential: ctx.config.RTC_TURN_CREDENTIAL,
    });
  }
  return { iceServers };
}

// ---- Feedback ---------------------------------------------------------------

async function listFeedback(interviewId: string): Promise<FeedbackDto[]> {
  const rows = await prisma.interviewFeedback.findMany({
    where: { interviewId },
    include: { author: { select: { publicId: true } } },
    orderBy: { submittedAt: 'asc' },
  });
  return rows.map((f) => ({
    publicId: f.publicId,
    authorName: `Interviewer ${f.author.publicId.slice(0, 4)}`,
    rating: f.rating,
    notes: f.notes,
    recommendation: f.recommendation,
    submittedAt: f.submittedAt.toISOString(),
  }));
}

export async function submitFeedback(
  auth: Auth,
  publicId: string,
  input: FeedbackCreateInput,
): Promise<{ ok: true }> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage); // host / interviewer only — never the candidate
  const i = access.interview;

  try {
    await prisma.interviewFeedback.create({
      data: {
        interviewId: i.id,
        authorId: auth.userId,
        rating: input.rating,
        notes: input.notes,
        recommendation: input.recommendation,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'CONFLICT', 'You have already submitted feedback for this interview');
    }
    throw err;
  }

  // Optionally advance the linked application via a LEGAL transition only.
  if (input.advanceApplicationTo && i.applicationId) {
    const app = await prisma.application.findUnique({ where: { id: i.applicationId } });
    if (app && !app.deletedAt) {
      if (!canCompanyTransition(app.status, input.advanceApplicationTo)) {
        throw new AppError(
          409,
          'CONFLICT',
          `Cannot move the application from ${app.status} to ${input.advanceApplicationTo}`,
        );
      }
      await prisma.application.update({
        where: { id: app.id },
        data: { status: input.advanceApplicationTo, decisionAt: new Date() },
      });
    }
  }
  return { ok: true };
}

export async function getFeedback(
  auth: Auth,
  publicId: string,
): Promise<{ feedback: FeedbackDto[] }> {
  const access = await loadVisibleInterview(auth, publicId);
  requireManage(access.canManage); // never the candidate
  return { feedback: await listFeedback(access.interview.id) };
}

// ---- Run (reuse the Phase-6 pipeline; tag with interviewId) ------------------

export async function runInterview(
  ctx: InterviewCtx,
  auth: Auth,
  publicId: string,
  input: InterviewRunInput,
): Promise<{ submissionPublicId: string }> {
  if (!ctx.publisher) {
    throw AppError.serviceUnavailable('Code execution is temporarily unavailable');
  }
  const access = await loadVisibleInterview(auth, publicId);
  // Only the candidate runs code (a Submission is attributed to their attempt).
  if (!access.isCandidate) {
    throw new AppError(403, 'FORBIDDEN', 'Only the candidate can run code in the interview');
  }
  if (access.interview.status !== 'LIVE') {
    throw new AppError(409, 'CONFLICT', 'The interview is not live');
  }
  const studentId = await requireStudentId(auth);

  // The question is the interview's, or an explicit one for this run.
  const slug = input.questionSlug ?? access.interview.question?.slug;
  if (!slug) throw new AppError(400, 'VALIDATION', 'No question to run against');
  const question = await prisma.question.findFirst({
    where: { slug, deletedAt: null },
    include: { testCases: { where: { deletedAt: null, isSample: true } } },
  });
  if (!question) throw AppError.notFound('Question not found');
  if (question.testCases.length === 0) {
    throw new AppError(409, 'CONFLICT', 'This question has no runnable sample testcases');
  }

  const inFlight = await prisma.submission.count({
    where: { studentId, status: { in: ['QUEUED', 'RUNNING'] }, deletedAt: null },
  });
  if (inFlight >= ctx.config.ARENA_MAX_INFLIGHT) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many submissions in progress — please wait');
  }

  const submission = await prisma.submission.create({
    data: {
      studentId,
      questionId: question.id,
      interviewId: access.interview.id,
      language: input.language as Prisma.SubmissionCreateInput['language'],
      sourceCode: input.sourceCode,
      kind: 'RUN',
      status: 'QUEUED',
      testsTotal: question.testCases.length,
    },
    select: { id: true, publicId: true },
  });
  try {
    await ctx.publisher.publishJob({ submissionPublicId: submission.publicId });
  } catch {
    await prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'ERROR', finishedAt: new Date() },
    });
    throw AppError.serviceUnavailable('Code execution is temporarily unavailable');
  }
  // The single most useful mark on a review timeline: when the candidate
  // actually attempted the problem.
  await logEvent(access.interview.id, access.interview.startedAt, 'CODE_RUN', {
    actorUserId: auth.userId,
    label: question.title,
    meta: { language: input.language, submissionPublicId: submission.publicId },
  });
  return { submissionPublicId: submission.publicId };
}

// ---- Queries ----------------------------------------------------------------

export async function listInterviews(auth: Auth): Promise<InterviewListItem[]> {
  if (auth.role === 'COMPANY') {
    const rows = await prisma.interview.findMany({
      where: { hostKind: 'COMPANY', hostCompanyId: auth.companyId ?? '__none__', deletedAt: null },
      include: interviewInclude,
      orderBy: { scheduledStartsAt: 'desc' },
    });
    return rows.map((i) => mapListItem(i, true));
  }
  if (auth.role === 'UNIVERSITY') {
    const rows = await prisma.interview.findMany({
      where: {
        hostKind: 'UNIVERSITY',
        hostUniversityId: auth.universityId ?? '__none__',
        deletedAt: null,
      },
      include: interviewInclude,
      orderBy: { scheduledStartsAt: 'desc' },
    });
    return rows.map((i) => mapListItem(i, true));
  }
  if (auth.role === 'ADMIN') {
    const rows = await prisma.interview.findMany({
      where: { deletedAt: null },
      include: interviewInclude,
      orderBy: { scheduledStartsAt: 'desc' },
    });
    return rows.map((i) => mapListItem(i, true));
  }
  if (auth.role === 'RECRUITER') {
    // Interviews this recruiter is assigned to conduct.
    const rows = await prisma.interview.findMany({
      where: {
        participants: { some: { userId: auth.userId, role: 'INTERVIEWER' } },
        deletedAt: null,
      },
      include: interviewInclude,
      orderBy: { scheduledStartsAt: 'desc' },
    });
    return rows.map((i) => mapListItem(i, true));
  }
  // STUDENT — interviews where they are the candidate.
  const studentId = await requireStudentId(auth);
  const rows = await prisma.interview.findMany({
    where: { candidateStudentId: studentId, deletedAt: null },
    include: interviewInclude,
    orderBy: { scheduledStartsAt: 'desc' },
  });
  return rows.map((i) => mapListItem(i, false));
}

export async function getInterview(auth: Auth, publicId: string): Promise<InterviewDetail> {
  const access = await loadVisibleInterview(auth, publicId);
  return mapDetail(access.interview, access);
}
