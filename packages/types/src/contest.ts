import { z } from 'zod';
import { PROGRAMMING_LANGUAGES, type ProgrammingLanguage } from './arena.js';

/**
 * Phase 7 — Contests. A contest is "the Phase-6 execution pipeline run in a
 * timed window with a leaderboard". Shared contracts for api + web.
 */

// ---- Enums (mirror schema.prisma) -------------------------------------------

export const CONTEST_STATUSES = ['DRAFT', 'SCHEDULED', 'CANCELLED'] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

export const CONTEST_HOST_KINDS = ['UNIVERSITY', 'COMPANY'] as const;
export type ContestHostKind = (typeof CONTEST_HOST_KINDS)[number];

/**
 * Global, time-derived contest phase (not stored):
 *   upcoming — before entry opens (`startsAt`)
 *   open     — entry allowed: [startsAt, entryDeadline) — students may START
 *   running  — entry closed, attempts still in progress: [entryDeadline, overallEnd)
 *   ended    — after the last attempt could finish (entryDeadline + duration)
 */
export type ContestPhase = 'draft' | 'cancelled' | 'upcoming' | 'open' | 'running' | 'ended';

export interface ContestTiming {
  status: ContestStatus;
  startsAt: string | Date;
  entryDeadline: string | Date;
  durationMinutes: number;
}

/** The latest any attempt could finish = entryDeadline + duration. */
export function contestEndsAt(c: ContestTiming): Date {
  return new Date(new Date(c.entryDeadline).getTime() + c.durationMinutes * 60_000);
}

/** Single source of truth for a contest's phase (client + server). */
export function deriveContestPhase(c: ContestTiming, now: Date = new Date()): ContestPhase {
  if (c.status === 'CANCELLED') return 'cancelled';
  if (c.status === 'DRAFT') return 'draft';
  const t = now.getTime();
  const start = new Date(c.startsAt).getTime();
  const deadline = new Date(c.entryDeadline).getTime();
  const end = contestEndsAt(c).getTime();
  if (t < start) return 'upcoming';
  if (t < deadline) return 'open';
  if (t < end) return 'running';
  return 'ended';
}

/** A student's personal attempt deadline = startedAt + duration. */
export function participantDeadline(startedAt: string | Date, durationMinutes: number): Date {
  return new Date(new Date(startedAt).getTime() + durationMinutes * 60_000);
}

/** Whether a student may START a fresh attempt now (entry window is open). */
export function canStartContest(c: ContestTiming, now: Date = new Date()): boolean {
  return deriveContestPhase(c, now) === 'open';
}

// ---- Request schemas --------------------------------------------------------

const title = z.string().trim().min(3).max(200);
const description = z.string().trim().min(1).max(10_000);
const languages = z.array(z.enum(PROGRAMMING_LANGUAGES)).min(1);

/** `POST /contests` — create a DRAFT. Company hosts pick a target university. */
export const contestCreateSchema = z
  .object({
    title,
    description,
    // Target university by publicId. For a UNIVERSITY host this may be omitted
    // (server uses its own); a COMPANY host must supply it.
    targetUniversityPublicId: z.string().uuid().optional(),
    allowedLanguages: languages,
    startsAt: z.string().datetime(),
    entryDeadline: z.string().datetime(),
    durationMinutes: z.number().int().min(5).max(1440),
  })
  .refine((v) => new Date(v.entryDeadline) > new Date(v.startsAt), {
    message: 'Entry deadline must be after the start time',
    path: ['entryDeadline'],
  });
export type ContestCreateInput = z.infer<typeof contestCreateSchema>;

export const contestUpdateSchema = z
  .object({
    title,
    description,
    allowedLanguages: languages,
    startsAt: z.string().datetime(),
    entryDeadline: z.string().datetime(),
    durationMinutes: z.number().int().min(5).max(1440),
  })
  .partial();
export type ContestUpdateInput = z.infer<typeof contestUpdateSchema>;

/** Attach a bank question (by slug) OR author a custom one. */
const customTestCase = z.object({
  input: z.string().max(20_000),
  expectedOutput: z.string().max(20_000),
  isSample: z.boolean(),
});
export const attachQuestionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('bank'), slug: z.string().trim().min(1).max(200) }),
  z.object({
    mode: z.literal('custom'),
    title,
    description,
    constraints: z.string().trim().max(4000).optional(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    topic: z.enum([
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
    ]),
    testCases: z.array(customTestCase).min(1).max(50),
  }),
]);
export type AttachQuestionInput = z.infer<typeof attachQuestionSchema>;

// ---- Response DTOs ----------------------------------------------------------

export interface ContestHostRef {
  kind: ContestHostKind;
  name: string;
}

export interface ContestListItem {
  publicId: string;
  title: string;
  phase: ContestPhase;
  status: ContestStatus;
  startsAt: string; // ISO
  entryDeadline: string; // ISO
  durationMinutes: number;
  host: ContestHostRef;
  targetUniversity: { publicId: string; name: string };
  questionCount: number;
  participantCount: number;
  // Student view — attempt state.
  joined?: boolean;
  startedAt?: string | null;
  submittedAt?: string | null;
}

export interface ContestListResponse {
  contests: ContestListItem[];
}

/** A question row in a contest (statements withheld until live). */
export interface ContestQuestionRow {
  slug: string;
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  ordinal: number;
  solved?: boolean; // student view
}

export interface ContestDetail {
  publicId: string;
  title: string;
  description: string;
  phase: ContestPhase;
  status: ContestStatus;
  startsAt: string; // ISO
  entryDeadline: string; // ISO
  endsAt: string; // ISO — latest an attempt could finish
  durationMinutes: number;
  allowedLanguages: ProgrammingLanguage[];
  host: ContestHostRef;
  targetUniversity: { publicId: string; name: string };
  questionCount: number;
  participantCount: number;
  canManage: boolean; // the caller is the host
  // Student view — attempt state.
  joined?: boolean;
  startedAt?: string | null;
  submittedAt?: string | null;
  /** The caller's personal deadline (startedAt + duration), if they've started. */
  attemptEndsAt?: string | null;
  /** Present only when the caller may see the questions (host, or the student has started). */
  questions?: ContestQuestionRow[];
}

/** One row of the leaderboard. */
export interface LeaderboardEntry {
  rank: number;
  studentPublicId: string;
  displayName: string;
  score: number; // total testcases passed (best per question)
  solved: number; // questions with an ACCEPTED best
  timeMs: number; // tie-break: time to reach the current score
  perQuestion: { slug: string; bestTestsPassed: number; solved: boolean }[];
}

export interface LeaderboardResponse {
  contest: { publicId: string; title: string; phase: ContestPhase };
  entries: LeaderboardEntry[];
}

export interface JoinContestResponse {
  joined: true;
}
