import { prisma } from '@code-nexus/db';
import type { Logger } from '@code-nexus/logger';
import type { ExecutionJob, SubmissionKind, Verdict } from '@code-nexus/types';
import {
  normalizeOutput,
  verdictFromStatus,
  type Judge0Client,
  type Judge0Item,
  type Judge0Result,
} from './judge0.js';

/** The graded outcome of a submission, ready to persist. */
export interface GradedResult {
  verdict: Verdict;
  testsPassed: number;
  testsTotal: number;
  failedTestIndex: number | null; // 1-based
  runtimeMs: number | null;
  memoryKb: number | null;
  // RUN only — the sample output shown to the student.
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
}

/**
 * Pure grading: given the expected outputs and the Judge0 results (in testcase
 * order), decide the verdict, counts, and first-failing index. Accepted/Wrong
 * Answer are decided by our whitespace-aware comparison; other statuses (TLE,
 * runtime, compile, internal) come from the Judge0 status. Short-circuits at the
 * first failing testcase (like a judge).
 */
export function gradeSubmission(
  kind: SubmissionKind,
  expectedOutputs: string[],
  results: Judge0Result[],
): GradedResult {
  const testsTotal = results.length;
  let runtimeMs: number | null = null;
  let memoryKb: number | null = null;
  const track = (r: Judge0Result) => {
    if (r.timeMs != null) runtimeMs = Math.max(runtimeMs ?? 0, r.timeMs);
    if (r.memoryKb != null) memoryKb = Math.max(memoryKb ?? 0, r.memoryKb);
  };

  // RUN surfaces the first testcase's raw output for display.
  const first = results[0];
  const io =
    kind === 'RUN' && first
      ? { stdout: first.stdout, stderr: first.stderr, compileOutput: first.compileOutput }
      : { stdout: null, stderr: null, compileOutput: null };

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i]!;
    track(r);

    // Compilation error fails the whole submission (no testcase runs).
    if (r.statusId === 6) {
      return {
        verdict: 'COMPILATION_ERROR',
        testsPassed: 0,
        testsTotal,
        failedTestIndex: 1,
        runtimeMs,
        memoryKb,
        ...io,
        compileOutput: r.compileOutput ?? io.compileOutput,
      };
    }

    // Accepted/Wrong-Answer → compare output ourselves.
    if (r.statusId === 3 || r.statusId === 4) {
      const ok = normalizeOutput(r.stdout) === normalizeOutput(expectedOutputs[i] ?? '');
      if (!ok) {
        return {
          verdict: 'WRONG_ANSWER',
          testsPassed: i,
          testsTotal,
          failedTestIndex: i + 1,
          runtimeMs,
          memoryKb,
          ...io,
        };
      }
      continue; // this testcase passed
    }

    // TLE / runtime / internal → first failure decides the verdict.
    return {
      verdict: verdictFromStatus(r.statusId),
      testsPassed: i,
      testsTotal,
      failedTestIndex: i + 1,
      runtimeMs,
      memoryKb,
      ...io,
    };
  }

  return {
    verdict: 'ACCEPTED',
    testsPassed: testsTotal,
    testsTotal,
    failedTestIndex: null,
    runtimeMs,
    memoryKb,
    ...io,
  };
}

/**
 * Handle one execution job: load the submission (idempotent — skip terminal
 * ones), run its testcases in Judge0, grade, and persist. NEVER throws for a
 * Judge0 failure — it marks the submission ERROR so the row always ends terminal
 * and the API/UI never hang.
 */
export async function handleJob(
  judge0: Judge0Client,
  job: ExecutionJob,
  logger?: Logger,
): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { publicId: job.submissionPublicId },
  });
  if (!submission) {
    logger?.warn({ job }, 'submission not found — dropping');
    return;
  }
  // Idempotent: a redelivered job for an already-finished submission is a no-op.
  if (submission.status === 'DONE' || submission.status === 'ERROR') return;

  const testCases = await prisma.testCase.findMany({
    where: {
      questionId: submission.questionId,
      deletedAt: null,
      ...(submission.kind === 'RUN' ? { isSample: true } : {}),
    },
    orderBy: { ordinal: 'asc' },
  });

  await prisma.submission.update({
    where: { id: submission.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  try {
    const items: Judge0Item[] = testCases.map((t) => ({
      language: submission.language,
      sourceCode: submission.sourceCode,
      stdin: t.input,
      expectedOutput: t.expectedOutput,
    }));
    const results = await judge0.runBatch(items);
    const graded = gradeSubmission(
      submission.kind,
      testCases.map((t) => t.expectedOutput),
      results,
    );

    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: 'DONE',
        verdict: graded.verdict,
        testsPassed: graded.testsPassed,
        testsTotal: graded.testsTotal,
        failedTestIndex: graded.failedTestIndex,
        runtimeMs: graded.runtimeMs,
        memoryKb: graded.memoryKb,
        stdout: graded.stdout,
        stderr: graded.stderr,
        compileOutput: graded.compileOutput,
        finishedAt: new Date(),
      },
    });
    logger?.info({ submission: submission.publicId, verdict: graded.verdict }, 'submission graded');
  } catch (err) {
    logger?.error({ err, submission: submission.publicId }, 'execution failed — marking ERROR');
    await prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'ERROR', verdict: 'INTERNAL_ERROR', finishedAt: new Date() },
    });
  }
}
