import { Router, type Request } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { AppError } from '../../errors.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  applicationDecisionSchema,
  applicationPublicIdParam,
  applicationsQuerySchema,
  applyParam,
} from './applications.schema.js';
import {
  applyToDrive,
  decideApplication,
  listOwnApplications,
  listUniversityApplications,
  withdrawApplication,
} from './applications.service.js';

/**
 * Phase 4 — Applications. Student-initiated apply/withdraw and company-initiated
 * decisions (shortlist/offer/reject) validated against the state machine.
 * `GET /applications` is role-dispatched: a student sees their own, a university
 * its own students' (placement tracking). Ownership is enforced in the service.
 */
export function createApplicationsRouter(deps: ApiDeps): Router {
  const { sessionStore, logger } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };

  // Student applies to a drive (drive publicId in the path).
  router.post(
    '/drives/:publicId/apply',
    ...guards,
    requirePermission('application:create'),
    asyncHandler(async (req, res) => {
      const { publicId } = parseOrThrow(applyParam, req.params);
      const result = await applyToDrive(req.auth!, publicId);
      audit(req, 'application:create', result.publicId);
      res.status(201).json(result);
    }),
  );

  // Student withdraws their own application.
  router.post(
    '/applications/:publicId/withdraw',
    ...guards,
    requirePermission('application:withdraw'),
    asyncHandler(async (req, res) => {
      const { publicId } = parseOrThrow(applicationPublicIdParam, req.params);
      const result = await withdrawApplication(req.auth!, publicId);
      audit(req, 'application:withdraw', result.publicId);
      res.status(200).json(result);
    }),
  );

  // Company decides on an application (shortlist / offer / reject).
  router.patch(
    '/applications/:publicId',
    ...guards,
    requirePermission('application:decide'),
    asyncHandler(async (req, res) => {
      const { publicId } = parseOrThrow(applicationPublicIdParam, req.params);
      const body = parseOrThrow(applicationDecisionSchema, req.body);
      const result = await decideApplication(req.auth!, publicId, body);
      audit(req, 'application:decide', result.publicId);
      res.status(200).json(result);
    }),
  );

  // Role-dispatched list: student → own, university → its students'.
  router.get(
    '/applications',
    ...guards,
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(applicationsQuerySchema, req.query);
      const { role } = req.auth!;
      if (role === 'STUDENT') {
        res.status(200).json({ applications: await listOwnApplications(req.auth!, query) });
        return;
      }
      if (role === 'UNIVERSITY') {
        res.status(200).json({ applications: await listUniversityApplications(req.auth!, query) });
        return;
      }
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }),
  );

  return router;
}
