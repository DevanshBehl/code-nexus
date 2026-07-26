import { describe, expect, it } from 'vitest';
import { recruiterProfileSchema, studentProfileSchema } from './profile.js';

const validStudent = {
  firstName: 'Asha',
  lastName: 'Rao',
  rollNumber: 'CS21B045',
  branch: 'CSE',
  graduationYear: 2026,
  cgpa: 8.6,
  phone: '+91 98765 43210',
};

describe('studentProfileSchema', () => {
  it('accepts a complete valid profile', () => {
    expect(studentProfileSchema.safeParse(validStudent).success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { branch: _omit, ...rest } = validStudent;
    expect(studentProfileSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an out-of-range cgpa', () => {
    expect(studentProfileSchema.safeParse({ ...validStudent, cgpa: 11 }).success).toBe(false);
  });

  it('rejects an implausible graduation year', () => {
    expect(studentProfileSchema.safeParse({ ...validStudent, graduationYear: 1900 }).success).toBe(
      false,
    );
  });
});

describe('recruiterProfileSchema', () => {
  it('requires designation + phone', () => {
    expect(recruiterProfileSchema.safeParse({ firstName: 'K', lastName: 'M' }).success).toBe(false);
    expect(
      recruiterProfileSchema.safeParse({
        firstName: 'K',
        lastName: 'M',
        designation: 'Engineering Manager',
        phone: '9876543210',
      }).success,
    ).toBe(true);
  });
});
