import { Router } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { AppError } from '../../errors.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { orgSchemaForRole, profileSchemaForRole } from './profile.schema.js';
import {
  getOwnProfile,
  updateOrg,
  saveStudentProfile,
  saveRecruiterProfile,
} from './profile.service.js';
import { studentProfileSchema, recruiterProfileSchema } from '@code-nexus/types';

/**
 * Own-profile endpoints. `POST /auth/complete-onboarding` is handled in the auth
 * router (it flips status); here we expose read + edit of the caller's own data.
 */
export function createProfileRouter(deps: ApiDeps): Router {
  const { sessionStore, logger } = deps;
  const router = Router();
  const authed = [requireAuth(sessionStore), requirePasswordChanged] as const;

  // GET /me/profile — the caller's own profile (role-appropriate DTO).
  router.get(
    '/me/profile',
    ...authed,
    asyncHandler(async (req, res) => {
      const { userId, role } = req.auth!;
      res.status(200).json(await getOwnProfile(userId, role));
    }),
  );

  // PUT /me/profile — edit own profile (no status change). Student/Recruiter only.
  router.put(
    '/me/profile',
    ...authed,
    asyncHandler(async (req, res) => {
      const { userId, role } = req.auth!;
      const schema = profileSchemaForRole(role);
      if (!schema) throw new AppError(403, 'FORBIDDEN', 'This role has no editable profile');
      if (role === 'STUDENT') {
        await saveStudentProfile(userId, parseOrThrow(studentProfileSchema, req.body));
      } else {
        await saveRecruiterProfile(userId, parseOrThrow(recruiterProfileSchema, req.body));
      }
      logger.info(
        { requestId: req.requestId, actor: req.auth!.publicId, action: 'profile:update' },
        'profile updated',
      );
      res.status(200).json(await getOwnProfile(userId, role));
    }),
  );

  // PUT /me/org — edit own org/display details (University/Company/Admin).
  router.put(
    '/me/org',
    ...authed,
    asyncHandler(async (req, res) => {
      const { userId, role } = req.auth!;
      const schema = orgSchemaForRole(role);
      const input = parseOrThrow(schema, req.body);
      await updateOrg(userId, role, input);
      logger.info(
        { requestId: req.requestId, actor: req.auth!.publicId, action: 'org:update' },
        'org updated',
      );
      res.status(200).json(await getOwnProfile(userId, role));
    }),
  );

  return router;
}
