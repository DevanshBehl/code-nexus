import { describe, expect, it } from 'vitest';
import { ROLES, roleSchema, userStatusSchema } from './roles.js';

describe('roles', () => {
  it('exposes exactly the five platform roles', () => {
    expect(ROLES).toEqual(['STUDENT', 'UNIVERSITY', 'COMPANY', 'RECRUITER', 'ADMIN']);
  });

  it('accepts a valid role and rejects an invalid one', () => {
    expect(roleSchema.parse('STUDENT')).toBe('STUDENT');
    expect(roleSchema.safeParse('WIZARD').success).toBe(false);
  });

  it('defaults-friendly user status parses', () => {
    expect(userStatusSchema.parse('PENDING_PROFILE')).toBe('PENDING_PROFILE');
  });
});
