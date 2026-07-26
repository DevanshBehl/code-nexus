import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '@code-nexus/db';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { AppError } from '../../errors.js';
import { toMeDto } from '../../dto.js';
import { setSessionCookie, clearAuthCookies } from '../../cookies.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { loginSchema, changePasswordSchema } from './auth.schema.js';
import { authenticate, startSession, changeOwnPassword } from './auth.service.js';
import { completeOnboarding } from '../profile/profile.service.js';

export function createAuthRouter(deps: ApiDeps): Router {
  const { config, sessionStore, logger } = deps;
  const router = Router();

  // Rate limit: per-IP on the sensitive endpoints. 429 with Retry-After.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // Strict in production; generous in dev/test so local flows aren't blocked.
    limit: config.NODE_ENV === 'production' ? 10 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, please try again later')),
  });

  // ---- POST /auth/login -----------------------------------------------------
  router.post(
    '/auth/login',
    authLimiter,
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(loginSchema, req.body);
      let user;
      try {
        user = await authenticate(body.emailOrPublicId, body.password);
      } catch (err) {
        logger.warn(
          { requestId: req.requestId, action: 'login', outcome: 'failure' },
          'login failed',
        );
        throw err;
      }
      const { id } = await startSession(sessionStore, user, {
        ip: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      });
      setSessionCookie(res, id, config);
      logger.info(
        { requestId: req.requestId, actor: user.publicId, action: 'login', outcome: 'success' },
        'login success',
      );
      res.status(200).json(toMeDto(user));
    }),
  );

  // ---- POST /auth/logout ----------------------------------------------------
  router.post(
    '/auth/logout',
    requireAuth(sessionStore),
    asyncHandler(async (req, res) => {
      if (req.sessionId) await sessionStore.delete(req.sessionId);
      clearAuthCookies(res, config);
      logger.info(
        {
          requestId: req.requestId,
          actor: req.auth?.publicId,
          action: 'logout',
          outcome: 'success',
        },
        'logout',
      );
      res.status(200).json({ ok: true });
    }),
  );

  // ---- GET /auth/me ---------------------------------------------------------
  router.get(
    '/auth/me',
    requireAuth(sessionStore),
    asyncHandler(async (req, res) => {
      const user = await prisma.user.findFirstOrThrow({
        where: { id: req.auth!.userId, deletedAt: null },
      });
      res.status(200).json(toMeDto(user));
    }),
  );

  // ---- POST /auth/password (change own; allowed during forced reset) --------
  router.post(
    '/auth/password',
    authLimiter,
    requireAuth(sessionStore),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const body = parseOrThrow(changePasswordSchema(config.PASSWORD_MIN_LENGTH), req.body);
      await changeOwnPassword(
        config,
        actor.userId,
        actor.mustResetPassword,
        body.newPassword,
        body.currentPassword,
      );
      // Rotate: drop all sessions (incl. this one), then issue a fresh session.
      await sessionStore.deleteAllForUser(actor.userId);
      const { id } = await startSession(
        sessionStore,
        {
          id: actor.userId,
          publicId: actor.publicId,
          email: '',
          role: actor.role,
          status: actor.status,
          mustResetPassword: false,
        },
        { ip: req.ip, userAgent: req.get('user-agent') ?? undefined },
      );
      setSessionCookie(res, id, config);
      logger.info(
        {
          requestId: req.requestId,
          actor: actor.publicId,
          action: 'password-change',
          outcome: 'success',
        },
        'password changed',
      );
      res.status(200).json({ ok: true });
    }),
  );

  // ---- POST /auth/complete-onboarding ---------------------------------------
  // Phase 3: validates + persists the profile (required set), then flips
  // PENDING_PROFILE → ACTIVE. Org/Admin have no profile step (already ACTIVE).
  router.post(
    '/auth/complete-onboarding',
    requireAuth(sessionStore),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      if (actor.mustResetPassword) {
        throw new AppError(403, 'PASSWORD_RESET_REQUIRED', 'You must change your password first');
      }
      await completeOnboarding(actor.userId, actor.role, req.body);
      logger.info(
        {
          requestId: req.requestId,
          actor: actor.publicId,
          action: 'onboarding',
          outcome: 'success',
        },
        'onboarding complete',
      );
      res.status(200).json({ ok: true, status: 'ACTIVE' });
    }),
  );

  return router;
}

// TODO(phase5): self-service password reset via internal mail (needs mailing service).
