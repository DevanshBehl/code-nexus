import { Prisma, prisma } from '@code-nexus/db';
import type { AppConfig } from '@code-nexus/config';
import type { Publisher } from '@code-nexus/mq';
import type {
  ArenaStats,
  Difficulty,
  HeatmapResponse,
  ProgrammingLanguage,
  QuestionDetail,
  QuestionListItem,
  QuestionListQuery,
  QuestionListResponse,
  QuestionStatus,
  RunSubmitInput,
  SubmissionDto,
  SubmissionKind,
  SubmissionListRow,
} from '@code-nexus/types';
import type { Express } from 'express';
import { AppError } from '../../errors.js';

type Auth = Express.AuthContext;

// A non-terminal submission older than this (ms) with no worker result is
// surfaced as ERROR on read — so the UI never polls forever when the worker/
// Judge0 is down.
const STUCK_AFTER_MS = 45_000;

/** Resolve the caller's Student id (arena is student-facing). */
async function requireStudentId(auth: Auth): Promise<string> {
  const s = await prisma.student.findUnique({
    where: { userId: auth.userId },
    select: { id: true },
  });
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Student profile not found');
  return s.id;
}

/** Build the caller's per-question status lookup from their submit history. */
async function statusMaps(studentId: string): Promise<{
  solved: Set<string>;
  attempted: Set<string>;
}> {
  const [solvedRows, attemptedRows] = await Promise.all([
    prisma.submission.findMany({
      where: { studentId, kind: 'SUBMIT', verdict: 'ACCEPTED', deletedAt: null, contestId: null },
      select: { questionId: true },
      distinct: ['questionId'],
    }),
    prisma.submission.findMany({
      where: { studentId, kind: 'SUBMIT', deletedAt: null, contestId: null },
      select: { questionId: true },
      distinct: ['questionId'],
    }),
  ]);
  return {
    solved: new Set(solvedRows.map((r) => r.questionId)),
    attempted: new Set(attemptedRows.map((r) => r.questionId)),
  };
}

function statusFor(id: string, solved: Set<string>, attempted: Set<string>): QuestionStatus {
  if (solved.has(id)) return 'solved';
  if (attempted.has(id)) return 'attempted';
  return 'unsolved';
}

// ---- Questions --------------------------------------------------------------

export async function listQuestions(
  auth: Auth,
  query: QuestionListQuery,
): Promise<QuestionListResponse> {
  const studentId = await requireStudentId(auth);
  const where: Prisma.QuestionWhereInput = {
    published: true,
    deletedAt: null,
    ...(query.topic ? { topic: query.topic } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const [total, questions, maps] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      orderBy: [{ difficulty: 'asc' }, { title: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    statusMaps(studentId),
  ]);

  const items: QuestionListItem[] = questions.map((q) => ({
    slug: q.slug,
    title: q.title,
    difficulty: q.difficulty,
    topic: q.topic,
    status: statusFor(q.id, maps.solved, maps.attempted),
  }));
  return { items, page: query.page, pageSize: query.pageSize, total };
}

export async function getQuestion(auth: Auth, slug: string): Promise<QuestionDetail> {
  const studentId = await requireStudentId(auth);
  const q = await prisma.question.findFirst({
    where: { slug, published: true, deletedAt: null },
    include: {
      // ONLY sample testcases are ever serialized to the client.
      testCases: { where: { isSample: true, deletedAt: null }, orderBy: { ordinal: 'asc' } },
    },
  });
  if (!q) throw AppError.notFound('Question not found');
  const maps = await statusMaps(studentId);

  return {
    slug: q.slug,
    title: q.title,
    description: q.description,
    constraints: q.constraints,
    difficulty: q.difficulty,
    topic: q.topic,
    starterCode: (q.starterCode as Partial<Record<ProgrammingLanguage, string>> | null) ?? null,
    sampleTestCases: q.testCases.map((t) => ({ input: t.input, expectedOutput: t.expectedOutput })),
    status: statusFor(q.id, maps.solved, maps.attempted),
  };
}

// ---- Run / Submit (enqueue only — NO execution here) ------------------------

export async function enqueueRunOrSubmit(
  ctx: { config: AppConfig; publisher: Publisher | null },
  auth: Auth,
  slug: string,
  kind: SubmissionKind,
  input: RunSubmitInput,
): Promise<{ submissionPublicId: string }> {
  // Fail fast + cleanly if the broker is unavailable (no orphan rows).
  if (!ctx.publisher) {
    throw AppError.serviceUnavailable('Code execution is temporarily unavailable');
  }

  const studentId = await requireStudentId(auth);

  // Per-student rate limit: cap in-flight (QUEUED/RUNNING) submissions.
  const inFlight = await prisma.submission.count({
    where: { studentId, status: { in: ['QUEUED', 'RUNNING'] }, deletedAt: null },
  });
  if (inFlight >= ctx.config.ARENA_MAX_INFLIGHT) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many submissions in progress — please wait');
  }

  const question = await prisma.question.findFirst({
    where: { slug, published: true, deletedAt: null },
    include: {
      testCases: {
        where: { deletedAt: null, ...(kind === 'RUN' ? { isSample: true } : {}) },
      },
    },
  });
  if (!question) throw AppError.notFound('Question not found');
  if (question.testCases.length === 0) {
    throw new AppError(409, 'CONFLICT', 'This question has no runnable testcases');
  }

  const submission = await prisma.submission.create({
    data: {
      studentId,
      questionId: question.id,
      language: input.language,
      sourceCode: input.sourceCode,
      kind,
      status: 'QUEUED',
      testsTotal: question.testCases.length,
    },
    select: { publicId: true, id: true },
  });

  try {
    await ctx.publisher.publishJob({ submissionPublicId: submission.publicId });
  } catch {
    // Broker dropped mid-publish → mark the row ERROR and surface 503.
    await prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'ERROR', finishedAt: new Date() },
    });
    throw AppError.serviceUnavailable('Code execution is temporarily unavailable');
  }

  return { submissionPublicId: submission.publicId };
}

// ---- Submission reads (owner-scoped) ----------------------------------------

function toSubmissionDto(s: {
  publicId: string;
  kind: SubmissionKind;
  language: ProgrammingLanguage;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'ERROR';
  verdict: SubmissionDto['verdict'];
  testsPassed: number;
  testsTotal: number;
  failedTestIndex: number | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}): SubmissionDto {
  return {
    publicId: s.publicId,
    kind: s.kind,
    language: s.language,
    status: s.status,
    verdict: s.verdict,
    testsPassed: s.testsPassed,
    testsTotal: s.testsTotal,
    failedTestIndex: s.failedTestIndex,
    runtimeMs: s.runtimeMs,
    memoryKb: s.memoryKb,
    stdout: s.stdout,
    stderr: s.stderr,
    compileOutput: s.compileOutput,
    createdAt: s.createdAt.toISOString(),
    finishedAt: s.finishedAt?.toISOString() ?? null,
  };
}

export async function getSubmission(auth: Auth, publicId: string): Promise<SubmissionDto> {
  const studentId = await requireStudentId(auth);
  const s = await prisma.submission.findFirst({
    where: { publicId, studentId, deletedAt: null },
  });
  if (!s) throw AppError.notFound('Submission not found');

  // Reap a stuck submission (no worker/Judge0) so the UI stops polling.
  if (
    (s.status === 'QUEUED' || s.status === 'RUNNING') &&
    Date.now() - s.createdAt.getTime() > STUCK_AFTER_MS
  ) {
    const reaped = await prisma.submission.update({
      where: { id: s.id },
      data: { status: 'ERROR', finishedAt: new Date() },
    });
    return toSubmissionDto(reaped);
  }
  return toSubmissionDto(s);
}

export async function listSubmissions(
  auth: Auth,
  slug: string | undefined,
): Promise<SubmissionListRow[]> {
  const studentId = await requireStudentId(auth);
  const rows = await prisma.submission.findMany({
    where: {
      studentId,
      deletedAt: null,
      contestId: null,
      ...(slug ? { question: { slug } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((s) => ({
    publicId: s.publicId,
    kind: s.kind,
    language: s.language,
    status: s.status,
    verdict: s.verdict,
    testsPassed: s.testsPassed,
    testsTotal: s.testsTotal,
    createdAt: s.createdAt.toISOString(),
  }));
}

// ---- Heatmap + stats --------------------------------------------------------

export async function heatmap(auth: Auth, year: number): Promise<HeatmapResponse> {
  const studentId = await requireStudentId(auth);
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const rows = await prisma.submission.findMany({
    where: {
      studentId,
      kind: 'SUBMIT',
      deletedAt: null,
      contestId: null,
      createdAt: { gte: from, lt: to },
    },
    select: { createdAt: true },
  });

  const counts = new Map<string, number>();
  for (const r of rows) {
    const day = r.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { year, days };
}

export async function arenaStats(auth: Auth): Promise<ArenaStats> {
  const studentId = await requireStudentId(auth);
  const [solvedRows, attempted] = await Promise.all([
    prisma.submission.findMany({
      where: { studentId, kind: 'SUBMIT', verdict: 'ACCEPTED', deletedAt: null, contestId: null },
      select: { questionId: true, question: { select: { difficulty: true } } },
      distinct: ['questionId'],
    }),
    prisma.submission.findMany({
      where: { studentId, kind: 'SUBMIT', deletedAt: null, contestId: null },
      select: { questionId: true },
      distinct: ['questionId'],
    }),
  ]);

  const byDiff = (d: Difficulty) => solvedRows.filter((r) => r.question.difficulty === d).length;
  return {
    solved: {
      easy: byDiff('EASY'),
      medium: byDiff('MEDIUM'),
      hard: byDiff('HARD'),
      total: solvedRows.length,
    },
    attempted: attempted.length,
  };
}
