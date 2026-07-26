import type { Role, UserStatus } from '@code-nexus/types';
import { OWNERSHIP_SCOPED, ROLE_PERMISSIONS, type Permission } from './roles.js';

/**
 * The authenticated actor, derived from the session + a live DB reload of
 * status/role. `universityId`/`companyId` is the org this actor is scoped to
 * (their own University/Company id, or the uni/company they belong to).
 */
export interface Actor {
  userId: string;
  publicId: string;
  role: Role;
  status: UserStatus;
  universityId?: string | null;
  companyId?: string | null;
}

/** Ownership context for a targeted resource (the target account's org). */
export interface ResourceScope {
  universityId?: string | null;
  companyId?: string | null;
}

/**
 * The core authorization decision. Deny-by-default.
 *
 *  1. The actor's role must grant the permission at all.
 *  2. For an ownership-scoped permission (account:*), a non-admin actor must
 *     own the target: a UNIVERSITY matches by universityId, a COMPANY by
 *     companyId. ADMIN is unscoped (may act on anyone).
 */
export function can(actor: Actor, permission: Permission, resource?: ResourceScope): boolean {
  if (!ROLE_PERMISSIONS[actor.role].has(permission)) return false;

  if (OWNERSHIP_SCOPED.has(permission) && actor.role !== 'ADMIN') {
    if (actor.role === 'UNIVERSITY') {
      return (
        actor.universityId != null &&
        resource?.universityId != null &&
        actor.universityId === resource.universityId
      );
    }
    if (actor.role === 'COMPANY') {
      return (
        actor.companyId != null &&
        resource?.companyId != null &&
        actor.companyId === resource.companyId
      );
    }
    return false;
  }

  return true;
}
