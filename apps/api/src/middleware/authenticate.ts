import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@code-nexus/db';
import { SESSION_COOKIE, type SessionStore } from '@code-nexus/auth';
import { AppError } from '../errors.js';

/**
 * Loads and validates the session, then reloads the user LIVE from the DB so
 * suspension / soft-deletion / role changes take effect immediately. Attaches
 * `req.auth` on success; otherwise rejects with 401.
 */
export function requireAuth(sessionStore: SessionStore) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      const sessionId = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
      if (!sessionId) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

      const session = await sessionStore.get(sessionId);
      if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Session invalid or expired');

      const user = await prisma.user.findFirst({
        where: { id: session.userId, deletedAt: null },
      });
      if (!user || user.status === 'SUSPENDED') {
        await sessionStore.delete(sessionId).catch(() => undefined);
        throw new AppError(401, 'UNAUTHENTICATED', 'Session invalid or expired');
      }

      await sessionStore.touch(sessionId, Date.now());

      req.sessionId = sessionId;
      req.auth = {
        userId: user.id,
        publicId: user.publicId,
        role: user.role,
        status: user.status,
        mustResetPassword: user.mustResetPassword,
        universityId: session.universityId ?? null,
        companyId: session.companyId ?? null,
      };
    })().then(() => next(), next);
  };
}
