import { prisma } from '@code-nexus/db';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
  type SessionStore,
} from '@code-nexus/auth';
import type { AppConfig } from '@code-nexus/config';
import { AppError } from '../../errors.js';
import { loadOrgScope } from '../accounts.repo.js';

export interface AuthenticatedUser {
  id: string;
  publicId: string;
  email: string;
  role: 'STUDENT' | 'UNIVERSITY' | 'COMPANY' | 'RECRUITER' | 'ADMIN';
  status: 'PENDING_PROFILE' | 'ACTIVE' | 'SUSPENDED';
  mustResetPassword: boolean;
}

/**
 * Verify credentials WITHOUT revealing whether the account exists. Always runs a
 * bcrypt comparison (against a dummy hash for unknown users) for constant-ish
 * timing, and returns the SAME failure for unknown/wrong/suspended/deleted.
 */
export async function authenticate(
  emailOrPublicId: string,
  password: string,
): Promise<AuthenticatedUser> {
  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [{ email: emailOrPublicId.toLowerCase() }, { publicId: emailOrPublicId }],
    },
  });

  const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordOk = await verifyPassword(password, hash);

  if (!user || !passwordOk || user.status === 'SUSPENDED') {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  return {
    id: user.id,
    publicId: user.publicId,
    email: user.email,
    role: user.role,
    status: user.status,
    mustResetPassword: user.mustResetPassword,
  };
}

/** Create a session for a freshly-authenticated user; records lastLoginAt. */
export async function startSession(
  store: SessionStore,
  user: AuthenticatedUser,
  meta: { ip?: string; userAgent?: string },
): Promise<{ id: string }> {
  const scope = await loadOrgScope(user.id, user.role);
  const { id } = await store.create({
    userId: user.id,
    publicId: user.publicId,
    role: user.role,
    status: user.status,
    universityId: scope.universityId,
    companyId: scope.companyId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { id };
}

/**
 * Change the caller's own password. If not a forced reset, the current password
 * must be supplied and correct. Clears mustResetPassword and (caller handles)
 * session rotation + logout-all of other sessions.
 */
export async function changeOwnPassword(
  config: AppConfig,
  userId: string,
  mustReset: boolean,
  newPassword: string,
  currentPassword?: string,
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Session invalid');

  if (!mustReset) {
    if (!currentPassword) {
      throw new AppError(400, 'VALIDATION', 'Current password is required');
    }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword, config.BCRYPT_COST);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustResetPassword: false },
  });
}

// Onboarding (profile completion + status flip) now lives in
// modules/profile/profile.service.ts `completeOnboarding` (Phase 3).
