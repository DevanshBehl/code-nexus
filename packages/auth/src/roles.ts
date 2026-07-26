import type { Role } from '@code-nexus/types';

/**
 * The full permission catalog — the single source of truth for authorization.
 * A permission is a stable `"<resource>:<action>"` string.
 */
export const PERMISSIONS = [
  'auth:login',
  'auth:logout',
  'auth:me',
  'password:change:self',
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
  'dashboard:read:student',
  'dashboard:read:university',
  'dashboard:read:company',
  'dashboard:read:recruiter',
  'dashboard:read:admin',
  // Phase 4 — Placement Drives & Applications
  'drive:create',
  'drive:update',
  'drive:list:own',
  'drive:list:university',
  'drive:list:open',
  'drive:read',
  'application:create',
  'application:withdraw',
  'application:list:own',
  'application:list:drive',
  'application:list:university',
  'application:decide',
  // Phase 5 — Internal Mailing (directional recipient rules via canMail)
  'mail:send',
  'mail:read',
  // Phase 6 — Code Arena
  'arena:read',
  'arena:submit',
  'question:manage',
  // Phase 7 — Contests
  'contest:create',
  'contest:manage',
  'contest:read',
  'contest:participate',
  'contest:submit',
  // Phase 8 — Webinars
  'webinar:create',
  'webinar:manage',
  'webinar:read',
  'webinar:attend',
  // Phase 9 — Interviews
  'interview:schedule',
  'interview:manage',
  'interview:read',
  'interview:attend',
  'interview:feedback',
  // Phase 10 — Interview recordings. `recording:read` is held by every role
  // because the *scope* of what each can see is a per-recording ownership
  // question, not a coarse role question — the service narrows it via
  // `canViewRecording` and 404s anything outside the caller's lane.
  'recording:upload',
  'recording:read',
  'recording:delete',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Common permissions every authenticated user holds. Mailing is universally
// available (the directional recipient limits are enforced by `canMail`, not by
// these coarse permissions).
const COMMON: Permission[] = [
  'auth:login',
  'auth:logout',
  'auth:me',
  'password:change:self',
  'mail:send',
  'mail:read',
];

/**
 * Role → the permissions it can EVER hold. Deny-by-default: anything not listed
 * is denied. Ownership scoping for `account:*` is applied on top by `can()`.
 * Mirror of prompt_phase2.md §5.2.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
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
    // Phase 9 — recruiters CONDUCT interviews assigned to them: join the room,
    // run it (go-live / end / pin a question from the bank), and file feedback.
    // `interview:manage` is NOT ownership — the service still requires the caller
    // to be an assigned INTERVIEWER on that specific interview (a recruiter never
    // satisfies the host check), so this grants "run the calls I was put on",
    // nothing wider. Scheduling stays with the company (`interview:schedule`).
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

/**
 * Permissions that address a SPECIFIC existing account (by publicId) and must be
 * ownership-scoped for non-admin actors. (create/list scoping is enforced in
 * services from the session, not here.)
 */
export const OWNERSHIP_SCOPED: ReadonlySet<Permission> = new Set<Permission>([
  'account:reset-password',
  'account:suspend',
  'account:reactivate',
]);

/** The concrete permission list granted to a role (for `GET /auth/me`). */
export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
