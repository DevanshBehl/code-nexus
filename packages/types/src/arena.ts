import { z } from 'zod';

/**
 * Phase 6 — Code Arena contracts. Shared across the api (enqueue), the
 * execution-worker (run), and the web (workspace). Mirrors the Prisma enums.
 * Problems use the stdin/stdout model: the student's program reads stdin and
 * writes stdout; a testcase is (input, expectedOutput).
 */

// ---- Enums (mirror packages/db/prisma/schema.prisma) ------------------------

export const TOPICS = [
  'ARRAY',
  'STRING',
  'LINKED_LIST',
  'STACK_QUEUE',
  'TREE',
  'GRAPH',
  'HEAP',
  'HASHMAP',
  'DP',
  'GREEDY',
  'MATH',
] as const;
export type Topic = (typeof TOPICS)[number];

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const PROGRAMMING_LANGUAGES = ['PYTHON', 'CPP', 'JAVA', 'JAVASCRIPT'] as const;
export type ProgrammingLanguage = (typeof PROGRAMMING_LANGUAGES)[number];

export const SUBMISSION_KINDS = ['RUN', 'SUBMIT'] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const SUBMISSION_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'ERROR'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const VERDICTS = [
  'ACCEPTED',
  'WRONG_ANSWER',
  'TIME_LIMIT_EXCEEDED',
  'RUNTIME_ERROR',
  'COMPILATION_ERROR',
  'INTERNAL_ERROR',
] as const;
export type Verdict = (typeof VERDICTS)[number];

export function isTerminalSubmissionStatus(s: SubmissionStatus): boolean {
  return s === 'DONE' || s === 'ERROR';
}

/** Per-language display + Monaco editor metadata (Judge0 ids live in the worker). */
export interface LanguageMeta {
  language: ProgrammingLanguage;
  label: string;
  monaco: string; // Monaco language id
  filename: string;
}

export const LANGUAGE_META: Record<ProgrammingLanguage, LanguageMeta> = {
  PYTHON: { language: 'PYTHON', label: 'Python 3', monaco: 'python', filename: 'main.py' },
  CPP: { language: 'CPP', label: 'C++', monaco: 'cpp', filename: 'main.cpp' },
  JAVA: { language: 'JAVA', label: 'Java', monaco: 'java', filename: 'Main.java' },
  JAVASCRIPT: {
    language: 'JAVASCRIPT',
    label: 'JavaScript (Node)',
    monaco: 'javascript',
    filename: 'main.js',
  },
};

// ---- Execution job payload (published to RabbitMQ) --------------------------

/**
 * The ONLY thing put on the queue. The worker loads the submission, question and
 * testcases from Postgres by this id — the code/testcases never enter the broker.
 */
export interface ExecutionJob {
  submissionPublicId: string;
}

// ---- Request schemas --------------------------------------------------------

/** Body for `POST /arena/questions/:slug/run|submit`. */
export const runSubmitSchema = z.object({
  language: z.enum(PROGRAMMING_LANGUAGES),
  sourceCode: z.string().min(1).max(64_000),
});
export type RunSubmitInput = z.infer<typeof runSubmitSchema>;

export const questionListQuerySchema = z.object({
  topic: z.enum(TOPICS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(50),
});
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;

export const submissionsQuerySchema = z.object({
  slug: z.string().trim().min(1).max(200).optional(),
});
export type SubmissionsQuery = z.infer<typeof submissionsQuerySchema>;

export const heatmapQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type HeatmapQuery = z.infer<typeof heatmapQuerySchema>;

// ---- Response DTOs (hidden testcases NEVER serialized) ----------------------

export type QuestionStatus = 'unsolved' | 'attempted' | 'solved';

export interface QuestionListItem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  topic: Topic;
  status: QuestionStatus;
}

export interface QuestionListResponse {
  items: QuestionListItem[];
  page: number;
  pageSize: number;
  total: number;
}

/** A visible (sample) testcase — safe to show. */
export interface SampleTestCase {
  input: string;
  expectedOutput: string;
}

export interface QuestionDetail {
  slug: string;
  title: string;
  description: string;
  constraints: string | null;
  difficulty: Difficulty;
  topic: Topic;
  starterCode: Partial<Record<ProgrammingLanguage, string>> | null;
  sampleTestCases: SampleTestCase[];
  status: QuestionStatus;
}

/** The full submission result the student polls. */
export interface SubmissionDto {
  publicId: string;
  kind: SubmissionKind;
  language: ProgrammingLanguage;
  status: SubmissionStatus;
  verdict: Verdict | null;
  testsPassed: number;
  testsTotal: number;
  failedTestIndex: number | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  // RUN only — the sample output shown to the student.
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  createdAt: string; // ISO
  finishedAt: string | null;
}

export interface SubmissionListRow {
  publicId: string;
  kind: SubmissionKind;
  language: ProgrammingLanguage;
  status: SubmissionStatus;
  verdict: Verdict | null;
  testsPassed: number;
  testsTotal: number;
  createdAt: string;
}

export interface EnqueueResponse {
  submissionPublicId: string;
}

export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface HeatmapResponse {
  year: number;
  days: HeatmapDay[];
}

export interface ArenaStats {
  solved: { easy: number; medium: number; hard: number; total: number };
  attempted: number;
}
