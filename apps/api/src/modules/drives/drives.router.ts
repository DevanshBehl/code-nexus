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
  applicantsQuerySchema,
  driveCreateSchema,
  drivePublicIdParam,
  driveUpdateSchema,
} from './drives.schema.js';
import {
  closeDrive,
  createDrive,
  getDrive,
  listApplicants,
  listDrivesForActor,
  listUniversities,
  publishDrive,
  updateDrive,
} from './drives.service.js';

/**
 * Phase 4 — Placement Drives. Company/Admin own the write + lifecycle surface;
 * reads are role-scoped in the service (a company sees its own drives, a
 * university those targeting it, a student eligible OPEN drives). Ownership is
 * enforced in the service — cross-tenant access is a 404 (no existence leak).
 */
export function createDrivesRouter(deps: ApiDeps): Router {
  const { sessionStore, logger } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };

  const paramId = (req: Request): string => parseOrThrow(drivePublicIdParam, req.params).publicId;

  // Directory of universities to target (for the create-drive form). Company/Admin.
  router.get(
    '/directory/universities',
    ...guards,
    requirePermission('drive:create'),
    asyncHandler(async (_req, res) => {
      res.status(200).json({ universities: await listUniversities() });
    }),
  );

  // Create a drive (DRAFT). Company (own company from session) or Admin.
  router.post(
    '/drives',
    ...guards,
    requirePermission('drive:create'),
    asyncHandler(async (req, res) => {
      const companyId = req.auth!.companyId;
      if (!companyId) throw new AppError(403, 'FORBIDDEN', 'No company in scope');
      const body = parseOrThrow(driveCreateSchema, req.body);
      const drive = await createDrive(companyId, body);
      audit(req, 'drive:create', drive.publicId);
      res.status(201).json(drive);
    }),
  );

  // Role-scoped list.
  router.get(
    '/drives',
    ...guards,
    requirePermission('drive:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ drives: await listDrivesForActor(req.auth!) });
    }),
  );

  // Scoped detail.
  router.get(
    '/drives/:publicId',
    ...guards,
    requirePermission('drive:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getDrive(req.auth!, paramId(req)));
    }),
  );

  // Edit (DRAFT/OPEN). Owner company or Admin.
  router.patch(
    '/drives/:publicId',
    ...guards,
    requirePermission('drive:update'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(driveUpdateSchema, req.body);
      const drive = await updateDrive(req.auth!, paramId(req), body);
      audit(req, 'drive:update', drive.publicId);
      res.status(200).json(drive);
    }),
  );

  // Lifecycle: publish (DRAFT→OPEN) and close (OPEN→CLOSED).
  router.post(
    '/drives/:publicId/publish',
    ...guards,
    requirePermission('drive:update'),
    asyncHandler(async (req, res) => {
      const drive = await publishDrive(req.auth!, paramId(req));
      audit(req, 'drive:publish', drive.publicId);
      res.status(200).json(drive);
    }),
  );

  router.post(
    '/drives/:publicId/close',
    ...guards,
    requirePermission('drive:update'),
    asyncHandler(async (req, res) => {
      const drive = await closeDrive(req.auth!, paramId(req));
      audit(req, 'drive:close', drive.publicId);
      res.status(200).json(drive);
    }),
  );

  // Applicants (owner company / admin), with filters + sort.
  router.get(
    '/drives/:publicId/applicants',
    ...guards,
    requirePermission('application:list:drive'),
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(applicantsQuerySchema, req.query);
      res.status(200).json(await listApplicants(req.auth!, paramId(req), query));
    }),
  );

  return router;
}
