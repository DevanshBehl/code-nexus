import { describe, expect, it } from 'vitest';
import {
  canCompanyTransition,
  canStudentWithdraw,
  driveCreateSchema,
  evaluateEligibility,
  isTerminalApplicationStatus,
  type EligibilityDrive,
  type EligibilityStudent,
} from './drive.js';

describe('application state machine', () => {
  it('allows the legal company transitions only', () => {
    expect(canCompanyTransition('APPLIED', 'SHORTLISTED')).toBe(true);
    expect(canCompanyTransition('APPLIED', 'REJECTED')).toBe(true);
    expect(canCompanyTransition('SHORTLISTED', 'OFFERED')).toBe(true);
    expect(canCompanyTransition('SHORTLISTED', 'REJECTED')).toBe(true);
  });

  it('rejects illegal company transitions', () => {
    expect(canCompanyTransition('APPLIED', 'OFFERED')).toBe(false); // must shortlist first
    expect(canCompanyTransition('REJECTED', 'OFFERED')).toBe(false);
    expect(canCompanyTransition('OFFERED', 'REJECTED')).toBe(false);
    expect(canCompanyTransition('WITHDRAWN', 'SHORTLISTED')).toBe(false);
  });

  it('treats OFFERED/REJECTED/WITHDRAWN as terminal', () => {
    expect(isTerminalApplicationStatus('OFFERED')).toBe(true);
    expect(isTerminalApplicationStatus('REJECTED')).toBe(true);
    expect(isTerminalApplicationStatus('WITHDRAWN')).toBe(true);
    expect(isTerminalApplicationStatus('APPLIED')).toBe(false);
    expect(isTerminalApplicationStatus('SHORTLISTED')).toBe(false);
  });

  it('lets a student withdraw only from active states', () => {
    expect(canStudentWithdraw('APPLIED')).toBe(true);
    expect(canStudentWithdraw('SHORTLISTED')).toBe(true);
    expect(canStudentWithdraw('OFFERED')).toBe(false);
    expect(canStudentWithdraw('WITHDRAWN')).toBe(false);
  });
});

describe('evaluateEligibility', () => {
  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const student: EligibilityStudent = {
    universityId: 'uni-1',
    cgpa: 8.5,
    branch: 'CSE',
    graduationYear: 2026,
  };
  const drive: EligibilityDrive = {
    universityId: 'uni-1',
    status: 'OPEN',
    applyDeadline: future,
    minCgpa: 7,
    allowedBranches: ['CSE', 'ECE'],
    allowedGraduationYears: [2026],
  };

  it('passes an eligible student', () => {
    expect(evaluateEligibility(student, drive).eligible).toBe(true);
  });

  it('fails on wrong university', () => {
    const r = evaluateEligibility({ ...student, universityId: 'uni-2' }, drive);
    expect(r.eligible).toBe(false);
  });

  it('fails on low CGPA', () => {
    const r = evaluateEligibility({ ...student, cgpa: 6.5 }, drive);
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => /CGPA/i.test(x))).toBe(true);
  });

  it('matches branch case-insensitively', () => {
    expect(evaluateEligibility({ ...student, branch: 'cse' }, drive).eligible).toBe(true);
  });

  it('fails on branch not in the allowed list', () => {
    expect(evaluateEligibility({ ...student, branch: 'MECH' }, drive).eligible).toBe(false);
  });

  it('fails on graduation year not allowed', () => {
    expect(evaluateEligibility({ ...student, graduationYear: 2027 }, drive).eligible).toBe(false);
  });

  it('fails past the deadline', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(evaluateEligibility(student, { ...drive, applyDeadline: past }).eligible).toBe(false);
  });

  it('treats empty eligibility arrays as no restriction', () => {
    const open = { ...drive, minCgpa: null, allowedBranches: [], allowedGraduationYears: [] };
    expect(
      evaluateEligibility({ ...student, branch: 'ANY', graduationYear: 2030 }, open).eligible,
    ).toBe(true);
  });

  it('flags an incomplete profile', () => {
    const r = evaluateEligibility({ ...student, cgpa: null }, drive);
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => /profile/i.test(x))).toBe(true);
  });
});

describe('driveCreateSchema', () => {
  const base = {
    universityPublicId: '11111111-1111-1111-1111-111111111111',
    title: 'Backend Intern',
    description: 'Join us',
    applyDeadline: new Date(Date.now() + 86_400_000).toISOString(),
  };

  it('accepts a minimal valid drive and defaults arrays', () => {
    const parsed = driveCreateSchema.parse(base);
    expect(parsed.allowedBranches).toEqual([]);
    expect(parsed.allowedGraduationYears).toEqual([]);
  });

  it('rejects a too-short title', () => {
    expect(driveCreateSchema.safeParse({ ...base, title: 'a' }).success).toBe(false);
  });

  it('rejects an out-of-range CGPA gate', () => {
    expect(driveCreateSchema.safeParse({ ...base, minCgpa: 11 }).success).toBe(false);
  });
});
