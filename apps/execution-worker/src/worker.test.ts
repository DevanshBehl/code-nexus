import { describe, expect, it } from 'vitest';
import type { ProgrammingLanguage } from '@code-nexus/types';
import {
  JUDGE0_LANGUAGE_IDS,
  normalizeOutput,
  verdictFromStatus,
  type Judge0Result,
} from './judge0.js';
import { gradeSubmission } from './worker.js';

const ok = (stdout: string): Judge0Result => ({
  statusId: 3,
  stdout,
  stderr: null,
  compileOutput: null,
  timeMs: 12,
  memoryKb: 3000,
});

describe('language map', () => {
  it('maps every supported language to a Judge0 id', () => {
    const langs: ProgrammingLanguage[] = ['PYTHON', 'CPP', 'JAVA', 'JAVASCRIPT'];
    for (const l of langs) expect(typeof JUDGE0_LANGUAGE_IDS[l]).toBe('number');
  });
});

describe('verdictFromStatus', () => {
  it('maps Judge0 statuses to our taxonomy', () => {
    expect(verdictFromStatus(3)).toBe('ACCEPTED');
    expect(verdictFromStatus(4)).toBe('WRONG_ANSWER');
    expect(verdictFromStatus(5)).toBe('TIME_LIMIT_EXCEEDED');
    expect(verdictFromStatus(6)).toBe('COMPILATION_ERROR');
    expect(verdictFromStatus(7)).toBe('RUNTIME_ERROR');
    expect(verdictFromStatus(11)).toBe('RUNTIME_ERROR');
    expect(verdictFromStatus(13)).toBe('INTERNAL_ERROR');
    expect(verdictFromStatus(99)).toBe('INTERNAL_ERROR');
  });
});

describe('normalizeOutput (whitespace rule)', () => {
  it('ignores trailing whitespace per line and trailing newlines', () => {
    expect(normalizeOutput('4\n')).toBe('4');
    expect(normalizeOutput('4   ')).toBe('4');
    expect(normalizeOutput('a \nb\n\n')).toBe('a\nb');
    expect(normalizeOutput('a\r\nb')).toBe('a\nb');
  });
  it('does not ignore internal differences', () => {
    expect(normalizeOutput('4')).not.toBe(normalizeOutput('5'));
  });
});

describe('gradeSubmission', () => {
  it('ACCEPTED when every testcase output matches', () => {
    const g = gradeSubmission('SUBMIT', ['4', '20', '0'], [ok('4'), ok('20'), ok('0\n')]);
    expect(g.verdict).toBe('ACCEPTED');
    expect(g.testsPassed).toBe(3);
    expect(g.testsTotal).toBe(3);
    expect(g.failedTestIndex).toBeNull();
  });

  it('WRONG_ANSWER at the first mismatch (short-circuits)', () => {
    const g = gradeSubmission('SUBMIT', ['4', '20', '0'], [ok('4'), ok('999'), ok('0')]);
    expect(g.verdict).toBe('WRONG_ANSWER');
    expect(g.testsPassed).toBe(1);
    expect(g.failedTestIndex).toBe(2);
  });

  it('maps a TLE testcase', () => {
    const tle: Judge0Result = {
      statusId: 5,
      stdout: null,
      stderr: null,
      compileOutput: null,
      timeMs: null,
      memoryKb: null,
    };
    const g = gradeSubmission('SUBMIT', ['4', '20'], [ok('4'), tle]);
    expect(g.verdict).toBe('TIME_LIMIT_EXCEEDED');
    expect(g.failedTestIndex).toBe(2);
    expect(g.testsPassed).toBe(1);
  });

  it('compilation error fails the whole submission', () => {
    const ce: Judge0Result = {
      statusId: 6,
      stdout: null,
      stderr: null,
      compileOutput: 'syntax error',
      timeMs: null,
      memoryKb: null,
    };
    const g = gradeSubmission('SUBMIT', ['4'], [ce]);
    expect(g.verdict).toBe('COMPILATION_ERROR');
    expect(g.testsPassed).toBe(0);
    expect(g.compileOutput).toContain('syntax error');
  });

  it('RUN exposes the first testcase output; SUBMIT does not', () => {
    const run = gradeSubmission('RUN', ['4'], [ok('4')]);
    expect(run.stdout).toBe('4');
    const submit = gradeSubmission('SUBMIT', ['4'], [ok('4')]);
    expect(submit.stdout).toBeNull();
  });
});
