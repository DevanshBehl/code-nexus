import { describe, expect, it } from 'vitest';
import type { Role } from '@code-nexus/types';
import { canMail, type MailParty } from './mail-policy.js';

// Parties in "org A" and "org B" to exercise ownership scoping.
const studentA: MailParty = { role: 'STUDENT', universityId: 'uniA' };
const studentB: MailParty = { role: 'STUDENT', universityId: 'uniB' };
const uniA: MailParty = { role: 'UNIVERSITY', universityId: 'uniA' };
const uniB: MailParty = { role: 'UNIVERSITY', universityId: 'uniB' };
const companyA: MailParty = { role: 'COMPANY', companyId: 'coA' };
const companyB: MailParty = { role: 'COMPANY', companyId: 'coB' };
const recruiterA: MailParty = { role: 'RECRUITER', companyId: 'coA' };
const recruiterB: MailParty = { role: 'RECRUITER', companyId: 'coB' };
const admin: MailParty = { role: 'ADMIN' };

describe('canMail — student sender', () => {
  it('may mail own university and admin only', () => {
    expect(canMail(studentA, uniA)).toBe(true);
    expect(canMail(studentA, admin)).toBe(true);
  });
  it('may not mail another university, any student, or a company', () => {
    expect(canMail(studentA, uniB)).toBe(false);
    expect(canMail(studentA, studentA)).toBe(false); // policy-wise a student can't mail students
    expect(canMail(studentA, studentB)).toBe(false);
    expect(canMail(studentA, companyA)).toBe(false);
    expect(canMail(studentA, recruiterA)).toBe(false);
  });
});

describe('canMail — university sender', () => {
  it('may mail its own students, any company, and admin', () => {
    expect(canMail(uniA, studentA)).toBe(true);
    expect(canMail(uniA, companyA)).toBe(true);
    expect(canMail(uniA, companyB)).toBe(true);
    expect(canMail(uniA, admin)).toBe(true);
  });
  it("may not mail another university's student or another university", () => {
    expect(canMail(uniA, studentB)).toBe(false);
    expect(canMail(uniA, uniB)).toBe(false);
    expect(canMail(uniA, recruiterA)).toBe(false);
  });
});

describe('canMail — company sender', () => {
  it('may mail anyone', () => {
    for (const r of [studentA, studentB, uniA, uniB, companyB, recruiterA, admin]) {
      expect(canMail(companyA, r)).toBe(true);
    }
  });
});

describe('canMail — recruiter sender', () => {
  it('may mail own company and admin only', () => {
    expect(canMail(recruiterA, companyA)).toBe(true);
    expect(canMail(recruiterA, admin)).toBe(true);
  });
  it('may not mail another company, students, or universities', () => {
    expect(canMail(recruiterA, companyB)).toBe(false);
    expect(canMail(recruiterB, companyA)).toBe(false);
    expect(canMail(recruiterA, studentA)).toBe(false);
    expect(canMail(recruiterA, uniA)).toBe(false);
  });
});

describe('canMail — admin sender', () => {
  it('may mail anyone', () => {
    for (const r of [studentA, uniA, companyA, recruiterA, admin]) {
      expect(canMail(admin, r)).toBe(true);
    }
  });
});

describe('canMail — full role grid smoke check', () => {
  const roles: Role[] = ['STUDENT', 'UNIVERSITY', 'COMPANY', 'RECRUITER', 'ADMIN'];
  it('never throws for any role pairing', () => {
    for (const s of roles) {
      for (const r of roles) {
        expect(typeof canMail({ role: s }, { role: r })).toBe('boolean');
      }
    }
  });
});
