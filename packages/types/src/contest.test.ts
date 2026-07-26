import { describe, expect, it } from 'vitest';
import {
  attachQuestionSchema,
  contestCreateSchema,
  contestEndsAt,
  deriveContestPhase,
  participantDeadline,
} from './contest.js';

const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

describe('deriveContestPhase (entry window + per-attempt duration)', () => {
  const base = { startsAt: at(10), entryDeadline: at(70), durationMinutes: 60 };
  it('draft / cancelled override time', () => {
    expect(deriveContestPhase({ ...base, status: 'DRAFT' })).toBe('draft');
    expect(deriveContestPhase({ ...base, status: 'CANCELLED' })).toBe('cancelled');
  });
  it('upcoming before start', () => {
    expect(deriveContestPhase({ status: 'SCHEDULED', ...base })).toBe('upcoming');
  });
  it('open once entry is allowed (start reached, before deadline)', () => {
    expect(
      deriveContestPhase({
        status: 'SCHEDULED',
        startsAt: at(-5),
        entryDeadline: at(55),
        durationMinutes: 60,
      }),
    ).toBe('open');
  });
  it('running after the entry deadline but before the last attempt could end', () => {
    expect(
      deriveContestPhase({
        status: 'SCHEDULED',
        startsAt: at(-120),
        entryDeadline: at(-30),
        durationMinutes: 60,
      }),
    ).toBe('running');
  });
  it('ended after entryDeadline + duration', () => {
    expect(
      deriveContestPhase({
        status: 'SCHEDULED',
        startsAt: at(-240),
        entryDeadline: at(-180),
        durationMinutes: 60,
      }),
    ).toBe('ended');
  });
  it('endsAt = entryDeadline + duration; personal deadline = startedAt + duration', () => {
    const c = {
      status: 'SCHEDULED' as const,
      startsAt: '2026-01-01T00:00:00.000Z',
      entryDeadline: '2026-01-01T01:00:00.000Z',
      durationMinutes: 90,
    };
    expect(contestEndsAt(c).toISOString()).toBe('2026-01-01T02:30:00.000Z');
    expect(participantDeadline('2026-01-01T00:20:00.000Z', 90).toISOString()).toBe(
      '2026-01-01T01:50:00.000Z',
    );
  });
});

describe('contestCreateSchema', () => {
  const base = {
    title: 'Weekly Contest',
    description: 'Solve fast.',
    allowedLanguages: ['PYTHON', 'CPP'],
    startsAt: at(30),
    entryDeadline: at(90),
    durationMinutes: 90,
  };
  it('accepts a valid contest', () => {
    expect(contestCreateSchema.safeParse(base).success).toBe(true);
  });
  it('rejects an entry deadline before the start', () => {
    expect(contestCreateSchema.safeParse({ ...base, entryDeadline: at(10) }).success).toBe(false);
  });
  it('rejects empty languages', () => {
    expect(contestCreateSchema.safeParse({ ...base, allowedLanguages: [] }).success).toBe(false);
  });
  it('rejects a too-short duration', () => {
    expect(contestCreateSchema.safeParse({ ...base, durationMinutes: 1 }).success).toBe(false);
  });
});

describe('attachQuestionSchema', () => {
  it('accepts a bank attach', () => {
    expect(attachQuestionSchema.safeParse({ mode: 'bank', slug: 'two-sum' }).success).toBe(true);
  });
  it('accepts a custom question with testcases', () => {
    const r = attachQuestionSchema.safeParse({
      mode: 'custom',
      title: 'Add Two',
      description: 'read a b print a+b',
      difficulty: 'EASY',
      topic: 'MATH',
      testCases: [{ input: '1 2', expectedOutput: '3', isSample: true }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects a custom question with no testcases', () => {
    const r = attachQuestionSchema.safeParse({
      mode: 'custom',
      title: 'X',
      description: 'y',
      difficulty: 'EASY',
      topic: 'MATH',
      testCases: [],
    });
    expect(r.success).toBe(false);
  });
});
