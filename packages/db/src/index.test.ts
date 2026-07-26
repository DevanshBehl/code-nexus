import { describe, expect, it } from 'vitest';
import { Role, UserStatus } from '@prisma/client';

/**
 * Connection-free smoke test: verifies the generated Prisma enums match the
 * platform contract. Does NOT open a database connection (CI has no DB).
 */
describe('prisma enums', () => {
  it('exposes the five roles', () => {
    expect(Object.values(Role).sort()).toEqual(
      ['ADMIN', 'COMPANY', 'RECRUITER', 'STUDENT', 'UNIVERSITY'].sort(),
    );
  });

  it('exposes the three user statuses', () => {
    expect(Object.values(UserStatus).sort()).toEqual(
      ['ACTIVE', 'PENDING_PROFILE', 'SUSPENDED'].sort(),
    );
  });
});
