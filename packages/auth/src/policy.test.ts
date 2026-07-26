import { describe, expect, it } from 'vitest';
import type { Role } from '@code-nexus/types';
import { can, type Actor } from './policy.js';
import { PERMISSIONS, OWNERSHIP_SCOPED, type Permission } from './roles.js';

const COMMON: Permission[] = [
  'auth:login',
  'auth:logout',
  'auth:me',
  'password:change:self',
  'mail:send',
  'mail:read',
];

// Independent, hand-written expected grants (mirrors prompt_phase2.md §5.2) so a
// mistaken edit to ROLE_PERMISSIONS is caught rather than mirrored.
const EXPECTED: Record<Role, Set<Permission>> = {
  STUDENT: new Set<Permission>([
    ...COMMON,
    'dashboard:read:student',
    'drive:list:open',
    'drive:read',
    'application:create',
    'application:withdraw',
    'application:list:own',
    'arena:read',
    'arena:submit',
    'contest:read',
    'contest:participate',
    'contest:submit',
    'webinar:read',
    'webinar:attend',
    'interview:read',
    'interview:attend',
    'recording:read',
  ]),
  UNIVERSITY: new Set<Permission>([
    ...COMMON,
    'student:create',
    'student:list',
    'account:reset-password',
    'account:suspend',
    'account:reactivate',
    'dashboard:read:university',
    'drive:list:university',
    'drive:read',
    'application:list:university',
    'contest:create',
    'contest:manage',
    'contest:read',
    'webinar:create',
    'webinar:manage',
    'webinar:read',
    'interview:schedule',
    'interview:manage',
    'interview:read',
    'interview:feedback',
    'recording:read',
    'recording:upload',
    'recording:delete',
  ]),
  COMPANY: new Set<Permission>([
    ...COMMON,
    'recruiter:create',
    'recruiter:list',
    'account:reset-password',
    'account:suspend',
    'account:reactivate',
    'dashboard:read:company',
    'drive:create',
    'drive:update',
    'drive:list:own',
    'drive:read',
    'application:list:drive',
    'application:decide',
    'contest:create',
    'contest:manage',
    'contest:read',
    'webinar:create',
    'webinar:manage',
    'webinar:read',
    'interview:schedule',
    'interview:manage',
    'interview:read',
    'interview:feedback',
    'recording:read',
    'recording:upload',
    'recording:delete',
  ]),
  RECRUITER: new Set<Permission>([
    ...COMMON,
    'dashboard:read:recruiter',
    'interview:read',
    'interview:manage',
    'interview:feedback',
    // A recruiter captures the call they conduct, but may not destroy the record.
    'recording:read',
    'recording:upload',
  ]),
  ADMIN: new Set<Permission>([
    ...COMMON,
    'university:create',
    'company:create',
    'platformAdmin:create',
    'student:create',
    'student:list',
    'recruiter:create',
    'recruiter:list',
    'account:reset-password',
    'account:suspend',
    'account:reactivate',
    'dashboard:read:admin',
    'drive:create',
    'drive:update',
    'drive:list:own',
    'drive:list:university',
    'drive:read',
    'application:list:drive',
    'application:list:university',
    'application:decide',
    'arena:read',
    'question:manage',
    'contest:create',
    'contest:manage',
    'contest:read',
    'webinar:create',
    'webinar:manage',
    'webinar:read',
    'interview:schedule',
    'interview:manage',
    'interview:read',
    'interview:feedback',
    'recording:read',
    'recording:upload',
    'recording:delete',
  ]),
};

const ROLES: Role[] = ['STUDENT', 'UNIVERSITY', 'COMPANY', 'RECRUITER', 'ADMIN'];

function actor(role: Role, extra: Partial<Actor> = {}): Actor {
  return { userId: 'u', publicId: 'p', role, status: 'ACTIVE', ...extra };
}

describe('RBAC matrix — exhaustive (role × permission)', () => {
  for (const role of ROLES) {
    for (const permission of PERMISSIONS) {
      const granted = EXPECTED[role].has(permission);
      const scoped = OWNERSHIP_SCOPED.has(permission) && role !== 'ADMIN';

      it(`${role} ${granted ? 'CAN' : 'cannot'} ${permission}${scoped ? ' (scoped)' : ''}`, () => {
        if (scoped) {
          // Ownership-scoped: needs a matching resource to be allowed.
          const own = actor(role, { universityId: 'uni-1', companyId: 'co-1' });
          const match = role === 'UNIVERSITY' ? { universityId: 'uni-1' } : { companyId: 'co-1' };
          const mismatch =
            role === 'UNIVERSITY' ? { universityId: 'uni-2' } : { companyId: 'co-2' };
          expect(can(own, permission, match)).toBe(granted);
          expect(can(own, permission, mismatch)).toBe(false);
          expect(can(own, permission)).toBe(false); // no resource → denied
        } else {
          expect(can(actor(role), permission)).toBe(granted);
        }
      });
    }
  }
});

describe('ownership scoping', () => {
  it('ADMIN may reset any account, regardless of org', () => {
    const admin = actor('ADMIN');
    expect(can(admin, 'account:reset-password', { universityId: 'any' })).toBe(true);
    expect(can(admin, 'account:suspend', { companyId: 'any' })).toBe(true);
  });

  it('University A cannot suspend a student of University B', () => {
    const uniA = actor('UNIVERSITY', { universityId: 'A' });
    expect(can(uniA, 'account:suspend', { universityId: 'B' })).toBe(false);
    expect(can(uniA, 'account:suspend', { universityId: 'A' })).toBe(true);
  });

  it('Company cannot act on a student (wrong org dimension)', () => {
    const co = actor('COMPANY', { companyId: 'C' });
    expect(can(co, 'account:suspend', { universityId: 'C' })).toBe(false);
  });
});
