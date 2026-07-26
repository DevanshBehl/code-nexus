import { z } from 'zod';

/**
 * The five platform roles. This is the SINGLE source of truth for role strings
 * across every app/service. The Prisma `Role` enum (packages/db) must mirror
 * these exact values.
 */
export const ROLES = ['STUDENT', 'UNIVERSITY', 'COMPANY', 'RECRUITER', 'ADMIN'] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * User lifecycle status. `PENDING_PROFILE` is the default for freshly
 * provisioned accounts that must complete their profile on first login
 * (enforced in Phase 2/3).
 */
export const USER_STATUSES = ['PENDING_PROFILE', 'ACTIVE', 'SUSPENDED'] as const;

export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * The kinds of platform entities that carry a globally-unique `publicId`.
 * `publicId` can be used in place of email to reference any entity, and never
 * collides across kinds. Used from later phases (e.g. the mailing service).
 */
export const ENTITY_KINDS = [
  'STUDENT',
  'UNIVERSITY',
  'COMPANY',
  'RECRUITER',
  'PLATFORM_ADMIN',
] as const;

export const entityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof entityKindSchema>;
