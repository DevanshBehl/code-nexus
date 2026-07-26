import { describe, expect, it } from 'vitest';
import { mapPistonResult } from './piston.js';

describe('mapPistonResult', () => {
  it('maps a clean run to statusId 3 (grading compares output)', () => {
    const r = mapPistonResult({ run: { code: 0, stdout: '4\n', stderr: '', signal: null } });
    expect(r.statusId).toBe(3);
    expect(r.stdout).toBe('4\n');
  });

  it('maps a compile failure to statusId 6 with compiler output', () => {
    const r = mapPistonResult({
      compile: { code: 1, stdout: '', stderr: 'error: expected ;', signal: null },
      run: { code: null, stdout: '', stderr: '', signal: null },
    });
    expect(r.statusId).toBe(6);
    expect(r.compileOutput).toContain('expected ;');
  });

  it('maps a SIGKILL (timeout/OOM) to statusId 5 (TLE)', () => {
    const r = mapPistonResult({ run: { code: null, stdout: '', stderr: '', signal: 'SIGKILL' } });
    expect(r.statusId).toBe(5);
  });

  it('maps a non-zero exit to statusId 11 (runtime error)', () => {
    const r = mapPistonResult({ run: { code: 1, stdout: '', stderr: 'Traceback', signal: null } });
    expect(r.statusId).toBe(11);
    expect(r.stderr).toContain('Traceback');
  });
});
