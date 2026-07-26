import { describe, expect, it } from 'vitest';
import { localStatusId } from './local.js';

describe('localStatusId', () => {
  const base = { compileFailed: false, timedOut: false, exitCode: 0, signal: null };

  it('clean exit → 3 (grading compares output)', () => {
    expect(localStatusId(base)).toBe(3);
  });
  it('compile failure → 6', () => {
    expect(localStatusId({ ...base, compileFailed: true })).toBe(6);
  });
  it('wall-clock timeout → 5 (TLE)', () => {
    expect(localStatusId({ ...base, timedOut: true, exitCode: null, signal: 'SIGKILL' })).toBe(5);
  });
  it('CPU-limit SIGXCPU → 5 (TLE)', () => {
    expect(localStatusId({ ...base, exitCode: null, signal: 'SIGXCPU' })).toBe(5);
  });
  it('crash signal → 11 (runtime error)', () => {
    expect(localStatusId({ ...base, exitCode: null, signal: 'SIGSEGV' })).toBe(11);
  });
  it('non-zero exit → 11', () => {
    expect(localStatusId({ ...base, exitCode: 1 })).toBe(11);
  });
});
