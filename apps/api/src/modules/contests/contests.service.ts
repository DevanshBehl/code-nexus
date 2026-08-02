import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@code-nexus/db';
import type { AppConfig } from '@code-nexus/config';
import type { Publisher } from '@code-nexus/mq';
import {
  deriveContestPhase,
  contestEndsAt,
  participantDeadline,
  type AttachQuestionInput,
  type ContestCreateInput,
  type ContestDetail,
  type ContestHostRef,
  type ContestListItem,
  type ContestPhase,
  type ContestQuestionRow,
  type ContestSubmissionRow,
  type ContestUpdateInput,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type QuestionDetail,
  type SampleTestCase,
  type SubmissionKind,
  type RunSubmitInput,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';

type Auth = Express.AuthContext;

const contestInclude = {
  hostUniversity: true,
  hostCompany: true,
  targetUniversity: true,
  _count: { select: { questions: true, participants: true } },
} satisfies Prisma.ContestInclude;

type ContestRow = Prisma.ContestGetPayload<{ include: typeof contestInclude }>;

function hostRef(c: ContestRow): ContestHostRef {
  return {
    kind: c.hostKind,
    name:
      c.hostKind === 'UNIVERSITY' ? (c.hostUniversity?.name ?? '—') : (c.hostCompany?.name ?? '—'),
  };
}

function phaseOf(c: {
  status: ContestRow['status'];
  startsAt: Date;
  entryDeadline: Date;
  durationMinutes: number;
}): ContestPhase {
  return deriveContestPhase(c, new Date());
}

/** A participant's attempt state (whether they may still submit / re-enter). */
function attemptState(
  c: { durationMinutes: number },
  p: { startedAt: Date | null; submittedAt: Date | null } | null,
  now: Date = new Date(),
): { started: boolean; submitted: boolean; withinWindow: boolean; deadline: Date | null } {
  const started = !!p?.startedAt;
  const submitted = !!p?.submittedAt;
  const deadline = p?.startedAt ? participantDeadline(p.startedAt, c.durationMinutes) : null;
  const withinWindow = started && !submitted && !!deadline && now < deadline;
  return { started, submitted, withinWindow, deadline };
}

async function requireStudent(auth: Auth): Promise<{ id: string; universityId: string }> {
  const s = await prisma.student.findUnique({
    where: { userId: auth.userId },
    select: { id: true, universityId: true, firstName: true, lastName: true },
  });
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Student profile not found');
  return { id: s.id, universityId: s.universityId };
}

async function resolveUniversityId(publicId: string): Promise<string> {
  const uni = await prisma.university.findFirst({ where: { publicId, deletedAt: null } });
  if (!uni) throw new AppError(404, 'NOT_FOUND', 'Target university not found');
  return uni.id;
}

/** Load a contest and enforce that `auth` may see it; returns row + canManage. */
async function loadVisibleContest(
  auth: Auth,
  publicId: string,
): Promise<{ contest: ContestRow; canManage: boolean }> {
  const c = await prisma.contest.findFirst({
    where: { publicId, deletedAt: null },
    include: contestInclude,
  });
  if (!c) throw AppError.notFound('Contest not found');

  const canManage =
    auth.role === 'ADMIN' ||
    (auth.role === 'UNIVERSITY' &&
      c.hostKind === 'UNIVERSITY' &&
      c.hostUniversityId === auth.universityId) ||
    (auth.role === 'COMPANY' && c.hostKind === 'COMPANY' && c.hostCompanyId === auth.companyId);
  if (canManage) return { contest: c, canManage: true };

  // Students of the target university may see SCHEDULED (non-draft/cancelled) contests.
  if (auth.role === 'STUDENT') {
    const s = await requireStudent(auth);
    if (c.targetUniversityId === s.universityId && c.status === 'SCHEDULED') {
      return { contest: c, canManage: false };
    }
  }
  throw AppError.notFound('Contest not found');
}

function requireManage(canManage: boolean): void {
  if (!canManage) throw new AppError(403, 'FORBIDDEN', 'You do not host this contest');
}

// ---- Commands ---------------------------------------------------------------

export async function createContest(auth: Auth, input: ContestCreateInput): Promise<ContestDetail> {
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
      throw new AppError(400, 'VALIDATION', 'A company contest must target a university');
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

  const c = await prisma.contest.create({
    data: {
      title: input.title,
      description: input.description,
      hostKind,
      hostUniversityId,
      hostCompanyId,
      targetUniversityId,
      allowedLanguages: input.allowedLanguages,
      startsAt: new Date(input.startsAt),
      entryDeadline: new Date(input.entryDeadline),
      durationMinutes: input.durationMinutes,
      status: 'DRAFT',
      createdById: auth.userId,
    },
    include: contestInclude,
  });
  return mapDetail(c, true);
}

export async function updateContest(
  auth: Auth,
  publicId: string,
  input: ContestUpdateInput,
): Promise<ContestDetail> {
  const { contest, canManage } = await loadVisibleContest(auth, publicId);
  requireManage(canManage);
  const phase = phaseOf(contest);
  // Editable while draft or before the entry window opens (upcoming).
  if (phase !== 'draft' && phase !== 'upcoming') {
    throw new AppError(409, 'CONFLICT', 'A contest can only be edited before entry opens');
  }
  const data: Prisma.ContestUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.allowedLanguages !== undefined) data.allowedLanguages = input.allowedLanguages;
  if (input.startsAt !== undefined) data.startsAt = new Date(input.startsAt);
  if (input.entryDeadline !== undefined) data.entryDeadline = new Date(input.entryDeadline);
  if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;

  // The entry deadline must remain after the start time.
  const effStart = input.startsAt ? new Date(input.startsAt) : contest.startsAt;
  const effDeadline = input.entryDeadline ? new Date(input.entryDeadline) : contest.entryDeadline;
  if (effDeadline <= effStart) {
    throw new AppError(400, 'VALIDATION', 'Entry deadline must be after the start time');
  }

  const updated = await prisma.contest.update({
    where: { id: contest.id },
    data,
    include: contestInclude,
  });
  return mapDetail(updated, true);
}

export async function publishContest(auth: Auth, publicId: string): Promise<ContestDetail> {
  const { contest, canManage } = await loadVisibleContest(auth, publicId);
  requireManage(canManage);
  if (contest.status !== 'DRAFT') {
    throw new AppError(409, 'CONFLICT', 'Only a draft contest can be published');
  }
  if (contest.entryDeadline.getTime() <= Date.now()) {
    throw new AppError(400, 'VALIDATION', 'The entry deadline must be in the future to publish');
  }
  const qCount = await prisma.contestQuestion.count({
    where: { contestId: contest.id, deletedAt: null },
  });
  if (qCount === 0)
    throw new AppError(409, 'CONFLICT', 'Add at least one question before publishing');

  const updated = await prisma.contest.update({
    where: { id: contest.id },
    data: { status: 'SCHEDULED' },
    include: contestInclude,
  });
  return mapDetail(updated, true);
}

export async function cancelContest(auth: Auth, publicId: string): Promise<ContestDetail> {
  const { contest, canManage } = await loadVisibleContest(auth, publicId);
  requireManage(canManage);
  const phase = phaseOf(contest);
  if (phase !== 'draft' && phase !== 'upcoming') {
    throw new AppError(409, 'CONFLICT', 'Only a draft or upcoming contest can be cancelled');
  }
  const updated = await prisma.contest.update({
    where: { id: contest.id },
    data: { status: 'CANCELLED' },
    include: contestInclude,
  });
  return mapDetail(updated, true);
}

export async function attachQuestion(
  auth: Auth,
  publicId: string,
  input: AttachQuestionInput,
): Promise<{ ok: true }> {
  const { contest, canManage } = await loadVisibleContest(auth, publicId);
  requireManage(canManage);
  const phase = phaseOf(contest);
  if (phase !== 'draft' && phase !== 'upcoming') {
    throw new AppError(409, 'CONFLICT', 'Questions can only be changed before the contest is live');
  }

  const next = await prisma.contestQuestion.count({ where: { contestId: contest.id } });
  const ordinal = next + 1;

  if (input.mode === 'bank') {
    const q = await prisma.question.findFirst({
      where: { slug: input.slug, published: true, deletedAt: null },
    });
    if (!q) throw AppError.notFound('Bank question not found');
    try {
      await prisma.contestQuestion.create({
        data: { contestId: contest.id, questionId: q.id, ordinal },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'CONFLICT', 'That question is already in the contest');
      }
      throw err;
    }
    return { ok: true };
  }

  // Custom question — a private (published:false) Question the public arena never lists.
  await prisma.$transaction(async (tx) => {
    const q = await tx.question.create({
      data: {
        slug: `custom-${randomUUID()}`,
        title: input.title,
        description: input.description,
        constraints: input.constraints ?? null,
        difficulty: input.difficulty,
        topic: input.topic,
        published: false,
        createdById: auth.userId,
        testCases: {
          create: input.testCases.map((t, i) => ({
            input: t.input,
            expectedOutput: t.expectedOutput,
            isSample: t.isSample,
            ordinal: i + 1,
          })),
        },
      },
    });
    await tx.contestQuestion.create({ data: { contestId: contest.id, questionId: q.id, ordinal } });
  });
  return { ok: true };
}

export async function removeQuestion(
  auth: Auth,
  publicId: string,
  slug: string,
): Promise<{ ok: true }> {
  const { contest, canManage } = await loadVisibleContest(auth, publicId);
  requireManage(canManage);
  const phase = phaseOf(contest);
  if (phase !== 'draft' && phase !== 'upcoming') {
    throw new AppError(409, 'CONFLICT', 'Questions can only be changed before the contest is live');
  }
  const cq = await prisma.contestQuestion.findFirst({
    where: { contestId: contest.id, question: { slug } },
    include: { question: true },
  });
  if (!cq) throw AppError.notFound('Question not in this contest');
  await prisma.contestQuestion.delete({ where: { id: cq.id } });
  // If it was a custom (unpublished) question, soft-delete it too.
  if (!cq.question.published) {
    await prisma.question.update({ where: { id: cq.questionId }, data: { deletedAt: new Date() } });
  }
  return { ok: true };
}

async function participantOf(contestId: string, studentId: string) {
  return prisma.contestParticipant.findUnique({
    where: { contestId_studentId: { contestId, studentId } },
  });
}

/**
 * Begin (or resume) the student's SINGLE attempt. Starting is one-way: the timer
 * runs from `startedAt` regardless of leaving, so exiting and returning within
 * the window just resumes the same attempt — there is no fresh restart, and once
 * submitted or the window elapses the student is locked out.
 */
export async function startContest(
  auth: Auth,
  publicId: string,
): Promise<{ startedAt: string; attemptEndsAt: string }> {
  const { contest } = await loadVisibleContest(auth, publicId);
  const student = await requireStudent(auth);
  if (contest.targetUniversityId !== student.universityId) {
    throw new AppError(403, 'NOT_ELIGIBLE', 'This contest is not open to your university');
  }

  const existing = await participantOf(contest.id, student.id);
  const st = attemptState(contest, existing);
  if (st.submitted) throw new AppError(409, 'CONFLICT', 'You have already submitted this contest');
  if (st.started) {
    if (!st.withinWindow) throw new AppError(409, 'CONFLICT', 'Your attempt window has ended');
    return {
      startedAt: existing!.startedAt!.toISOString(),
      attemptEndsAt: st.deadline!.toISOString(),
    };
  }
  // Fresh start — only while the entry window is open.
  if (phaseOf(contest) !== 'open') {
    throw new AppError(409, 'CONFLICT', 'The entry window is not open');
  }
  const now = new Date();
  const updated = await prisma.contestParticipant.upsert({
    where: { contestId_studentId: { contestId: contest.id, studentId: student.id } },
    update: { startedAt: now },
    create: { contestId: contest.id, studentId: student.id, startedAt: now },
  });
  return {
    startedAt: updated.startedAt!.toISOString(),
    attemptEndsAt: participantDeadline(now, contest.durationMinutes).toISOString(),
  };
}

/** Finalize the attempt — no more submissions, no re-entry. Idempotent. */
export async function finishContest(auth: Auth, publicId: string): Promise<{ submitted: true }> {
  const { contest } = await loadVisibleContest(auth, publicId);
  const student = await requireStudent(auth);
  const existing = await participantOf(contest.id, student.id);
  if (!existing?.startedAt) {
    throw new AppError(409, 'CONFLICT', 'You have not started this contest');
  }
  if (!existing.submittedAt) {
    await prisma.contestParticipant.update({
      where: { id: existing.id },
      data: { submittedAt: new Date() },
    });
  }
  return { submitted: true };
}

// ---- Run / Submit (reuse the Phase-6 pipeline; tag with contestId) ----------

export async function enqueueContestSubmission(
  ctx: { config: AppConfig; publisher: Publisher | null },
  auth: Auth,
  publicId: string,
  slug: string,
  kind: SubmissionKind,
  input: RunSubmitInput,
): Promise<{ submissionPublicId: string }> {
  if (!ctx.publisher)
    throw AppError.serviceUnavailable('Code execution is temporarily unavailable');

  const student = await requireStudent(auth);
  const { contest } = await loadVisibleContest(auth, publicId);
  if (contest.targetUniversityId !== student.universityId) {
    throw new AppError(403, 'NOT_ELIGIBLE', 'This contest is not open to your university');
  }
  // Must be inside the student's own attempt window (started, not submitted,
  // before their personal deadline).
  const participant = await participantOf(contest.id, student.id);
  const st = attemptState(contest, participant);
  if (st.submitted) throw new AppError(409, 'CONFLICT', 'You have already submitted this contest');
  if (!st.started) throw new AppError(409, 'CONFLICT', 'Start the contest before submitting');
  if (!st.withinWindow) throw new AppError(409, 'CONFLICT', 'Your attempt window has ended');
  if (!contest.allowedLanguages.includes(input.language)) {
    throw new AppError(400, 'VALIDATION', 'That language is not allowed in this contest');
  }

  const cq = await prisma.contestQuestion.findFirst({
    where: { contestId: contest.id, question: { slug } },
    include: {
      question: {
        include: {
          testCases: { where: { deletedAt: null, ...(kind === 'RUN' ? { isSample: true } : {}) } },
        },
      },
    },
  });
  if (!cq) throw AppError.notFound('Question not in this contest');
  if (cq.question.testCases.length === 0) {
    throw new AppError(409, 'CONFLICT', 'This question has no runnable testcases');
  }

  // Rate limit: cap in-flight submissions (practice + contest) per student.
  const inFlight = await prisma.submission.count({
    where: { studentId: student.id, status: { in: ['QUEUED', 'RUNNING'] }, deletedAt: null },
  });
  if (inFlight >= ctx.config.ARENA_MAX_INFLIGHT) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many submissions in progress — please wait');
  }

  const submission = await prisma.submission.create({
    data: {
      studentId: student.id,
      questionId: cq.questionId,
      contestId: contest.id,
      language: input.language,
      sourceCode: input.sourceCode,
      kind,
      status: 'QUEUED',
      testsTotal: cq.question.testCases.length,
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
  return { submissionPublicId: submission.publicId };
}

// ---- Queries ----------------------------------------------------------------

async function participantMap(
  studentId: string,
  contestIds: string[],
): Promise<Map<string, { startedAt: Date | null; submittedAt: Date | null }>> {
  if (contestIds.length === 0) return new Map();
  const rows = await prisma.contestParticipant.findMany({
    where: { studentId, contestId: { in: contestIds }, deletedAt: null },
    select: { contestId: true, startedAt: true, submittedAt: true },
  });
  return new Map(
    rows.map((r) => [r.contestId, { startedAt: r.startedAt, submittedAt: r.submittedAt }]),
  );
}

function mapListItem(
  c: ContestRow,
  part?: { startedAt: Date | null; submittedAt: Date | null } | null,
): ContestListItem {
  return {
    publicId: c.publicId,
    title: c.title,
    phase: phaseOf(c),
    status: c.status,
    startsAt: c.startsAt.toISOString(),
    entryDeadline: c.entryDeadline.toISOString(),
    durationMinutes: c.durationMinutes,
    host: hostRef(c),
    targetUniversity: { publicId: c.targetUniversity.publicId, name: c.targetUniversity.name },
    questionCount: c._count.questions,
    participantCount: c._count.participants,
    ...(part !== undefined
      ? {
          joined: !!part,
          startedAt: part?.startedAt?.toISOString() ?? null,
          submittedAt: part?.submittedAt?.toISOString() ?? null,
        }
      : {}),
  };
}

function mapDetail(
  c: ContestRow,
  canManage: boolean,
  extra: Partial<ContestDetail> = {},
): ContestDetail {
  return {
    publicId: c.publicId,
    title: c.title,
    description: c.description,
    phase: phaseOf(c),
    status: c.status,
    startsAt: c.startsAt.toISOString(),
    entryDeadline: c.entryDeadline.toISOString(),
    endsAt: contestEndsAt(c).toISOString(),
    durationMinutes: c.durationMinutes,
    allowedLanguages: c.allowedLanguages,
    host: hostRef(c),
    targetUniversity: { publicId: c.targetUniversity.publicId, name: c.targetUniversity.name },
    questionCount: c._count.questions,
    participantCount: c._count.participants,
    canManage,
    ...extra,
  };
}

export async function listContests(auth: Auth): Promise<ContestListItem[]> {
  if (auth.role === 'UNIVERSITY') {
    const contests = await prisma.contest.findMany({
      where: {
        hostKind: 'UNIVERSITY',
        hostUniversityId: auth.universityId ?? '__none__',
        deletedAt: null,
      },
      include: contestInclude,
      orderBy: { startsAt: 'desc' },
    });
    return contests.map((c) => mapListItem(c));
  }
  if (auth.role === 'COMPANY') {
    const contests = await prisma.contest.findMany({
      where: { hostKind: 'COMPANY', hostCompanyId: auth.companyId ?? '__none__', deletedAt: null },
      include: contestInclude,
      orderBy: { startsAt: 'desc' },
    });
    return contests.map((c) => mapListItem(c));
  }
  if (auth.role === 'ADMIN') {
    const contests = await prisma.contest.findMany({
      where: { deletedAt: null },
      include: contestInclude,
      orderBy: { startsAt: 'desc' },
    });
    return contests.map((c) => mapListItem(c));
  }
  // STUDENT — contests targeting their university that are published.
  const student = await requireStudent(auth);
  const contests = await prisma.contest.findMany({
    where: { targetUniversityId: student.universityId, status: 'SCHEDULED', deletedAt: null },
    include: contestInclude,
    orderBy: { startsAt: 'desc' },
  });
  const parts = await participantMap(
    student.id,
    contests.map((c) => c.id),
  );
  return contests.map((c) => mapListItem(c, parts.get(c.id) ?? null));
}

/** Set of questionIds the student has an ACCEPTED submit for in this contest. */
async function solvedInContest(contestId: string, studentId: string): Promise<Set<string>> {
  const rows = await prisma.submission.findMany({
    where: { contestId, studentId, kind: 'SUBMIT', verdict: 'ACCEPTED', deletedAt: null },
    select: { questionId: true },
    distinct: ['questionId'],
  });
  return new Set(rows.map((r) => r.questionId));
}

export async function getContest(auth: Auth, publicId: string): Promise<ContestDetail> {
  const { contest, canManage } = await loadVisibleContest(auth, publicId);
  const phase = phaseOf(contest);

  const extra: Partial<ContestDetail> = {};
  let studentStarted = false;
  let student: { id: string; universityId: string } | null = null;
  if (auth.role === 'STUDENT') {
    student = await requireStudent(auth);
    const part = await participantOf(contest.id, student.id);
    studentStarted = !!part?.startedAt;
    extra.joined = !!part;
    extra.startedAt = part?.startedAt?.toISOString() ?? null;
    extra.submittedAt = part?.submittedAt?.toISOString() ?? null;
    extra.attemptEndsAt = part?.startedAt
      ? participantDeadline(part.startedAt, contest.durationMinutes).toISOString()
      : null;
  }

  // Statements are revealed to the host always, or to a student once they have
  // STARTED their attempt (or after the contest has globally ended).
  if (canManage || phase === 'ended' || studentStarted) {
    const cqs = await prisma.contestQuestion.findMany({
      where: { contestId: contest.id, deletedAt: null },
      include: { question: true },
      orderBy: { ordinal: 'asc' },
    });
    const solved = student ? await solvedInContest(contest.id, student.id) : new Set<string>();
    const rows: ContestQuestionRow[] = cqs.map((cq) => ({
      slug: cq.question.slug,
      title: cq.question.title,
      difficulty: cq.question.difficulty,
      ordinal: cq.ordinal,
      ...(auth.role === 'STUDENT' ? { solved: solved.has(cq.questionId) } : {}),
    }));
    extra.questions = rows;
  }

  return mapDetail(contest, canManage, extra);
}

/** Full statements + sample testcases for solving (host, a started student, or ended). */
export async function getContestQuestions(auth: Auth, publicId: string): Promise<QuestionDetail[]> {
  const { contest, canManage } = await loadVisibleContest(auth, publicId);
  const phase = phaseOf(contest);
  if (!canManage) {
    const student = await requireStudent(auth);
    const part = await participantOf(contest.id, student.id);
    if (!part?.startedAt && phase !== 'ended') {
      throw new AppError(403, 'FORBIDDEN', 'Start the contest to see the questions');
    }
  }
  const cqs = await prisma.contestQuestion.findMany({
    where: { contestId: contest.id, deletedAt: null },
    include: {
      question: {
        include: {
          testCases: { where: { isSample: true, deletedAt: null }, orderBy: { ordinal: 'asc' } },
        },
      },
    },
    orderBy: { ordinal: 'asc' },
  });

  let solved = new Set<string>();
  if (auth.role === 'STUDENT') {
    const student = await requireStudent(auth);
    solved = await solvedInContest(contest.id, student.id);
  }

  return cqs.map((cq) => {
    const q = cq.question;
    const samples: SampleTestCase[] = q.testCases.map((t) => ({
      input: t.input,
      expectedOutput: t.expectedOutput,
    }));
    return {
      slug: q.slug,
      title: q.title,
      description: q.description,
      constraints: q.constraints,
      difficulty: q.difficulty,
      topic: q.topic,
      starterCode: (q.starterCode as QuestionDetail['starterCode']) ?? null,
      sampleTestCases: samples,
      status: solved.has(q.id) ? 'solved' : 'unsolved',
    };
  });
}

/**
 * The caller's own submissions in this contest, newest first.
 *
 * Scoped to the caller and to this contest — a participant may see what they
 * sent and what came back of it, and nothing about anyone else. Standings are
 * the leaderboard's job, and they only ever expose aggregates.
 *
 * A host has no submissions of their own to look at; an empty list is the honest
 * answer rather than an error, so the room's UI needs no special case.
 */
export async function listContestSubmissions(
  auth: Auth,
  publicId: string,
): Promise<ContestSubmissionRow[]> {
  const { contest } = await loadVisibleContest(auth, publicId);
  if (auth.role !== 'STUDENT') return [];
  const student = await requireStudent(auth);

  const rows = await prisma.submission.findMany({
    where: { contestId: contest.id, studentId: student.id, deletedAt: null },
    include: { question: { select: { slug: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((s) => ({
    publicId: s.publicId,
    slug: s.question.slug,
    kind: s.kind,
    language: s.language,
    status: s.status,
    verdict: s.verdict,
    testsPassed: s.testsPassed,
    testsTotal: s.testsTotal,
    createdAt: s.createdAt.toISOString(),
  }));
}

// ---- Leaderboard ------------------------------------------------------------

export async function leaderboard(auth: Auth, publicId: string): Promise<LeaderboardResponse> {
  const { contest } = await loadVisibleContest(auth, publicId);

  const cqs = await prisma.contestQuestion.findMany({
    where: { contestId: contest.id, deletedAt: null },
    include: { question: { select: { id: true, slug: true } } },
    orderBy: { ordinal: 'asc' },
  });
  const questionSlug = new Map(cqs.map((cq) => [cq.questionId, cq.question.slug]));

  const subs = await prisma.submission.findMany({
    where: { contestId: contest.id, kind: 'SUBMIT', status: 'DONE', deletedAt: null },
    include: { student: { select: { publicId: true, firstName: true, lastName: true } } },
  });

  // best[studentId][questionId] = { testsPassed, finishedAt, solved }
  interface Best {
    testsPassed: number;
    finishedAt: number;
    solved: boolean;
  }
  const byStudent = new Map<string, { publicId: string; name: string; best: Map<string, Best> }>();

  for (const s of subs) {
    if (!questionSlug.has(s.questionId)) continue; // question removed
    const key = s.studentId;
    let entry = byStudent.get(key);
    if (!entry) {
      const name =
        [s.student.firstName, s.student.lastName].filter(Boolean).join(' ').trim() || 'Student';
      entry = { publicId: s.student.publicId, name, best: new Map() };
      byStudent.set(key, entry);
    }
    const finishedAt = (s.finishedAt ?? s.createdAt).getTime();
    const prev = entry.best.get(s.questionId);
    const better =
      !prev ||
      s.testsPassed > prev.testsPassed ||
      (s.testsPassed === prev.testsPassed && finishedAt < prev.finishedAt);
    if (better) {
      entry.best.set(s.questionId, {
        testsPassed: s.testsPassed,
        finishedAt,
        solved: s.verdict === 'ACCEPTED',
      });
    }
  }

  const startMs = contest.startsAt.getTime();
  const entries: Omit<LeaderboardEntry, 'rank'>[] = [...byStudent.values()].map((e) => {
    let score = 0;
    let solved = 0;
    let lastBestMs = startMs;
    const perQuestion = cqs.map((cq) => {
      const b = e.best.get(cq.questionId);
      const bestTestsPassed = b?.testsPassed ?? 0;
      const qSolved = b?.solved ?? false;
      score += bestTestsPassed;
      if (qSolved) solved += 1;
      if (b) lastBestMs = Math.max(lastBestMs, b.finishedAt);
      return { slug: cq.question.slug, bestTestsPassed, solved: qSolved };
    });
    return {
      studentPublicId: e.publicId,
      displayName: e.name,
      score,
      solved,
      timeMs: Math.max(0, lastBestMs - startMs),
      perQuestion,
    };
  });

  entries.sort((a, b) => b.score - a.score || a.timeMs - b.timeMs);
  const ranked: LeaderboardEntry[] = entries.map((e, i) => ({ rank: i + 1, ...e }));

  return {
    contest: { publicId: contest.publicId, title: contest.title, phase: phaseOf(contest) },
    entries: ranked,
  };
}
