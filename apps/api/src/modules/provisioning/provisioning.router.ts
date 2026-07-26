import { Router, type Request } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { AppError } from '../../errors.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { loadTargetAccountScope } from '../accounts.repo.js';
import type { ResourceScope } from '@code-nexus/auth';
import {
  createUniversitySchema,
  createCompanySchema,
  createPlatformAdminSchema,
  createStudentSchema,
  createRecruiterSchema,
  publicIdParam,
} from './provisioning.schema.js';
import {
  createUniversity,
  createCompany,
  createPlatformAdmin,
  createStudent,
  createRecruiter,
  listStudents,
  listRecruiters,
  resetAccountPassword,
  setAccountSuspended,
} from './provisioning.service.js';

export function createProvisioningRouter(deps: ApiDeps): Router {
  const { config, sessionStore, logger } = deps;
  const router = Router();

  // Common guards for every provisioning route: authenticated + past first-login.
  const authed = [requireAuth(sessionStore), requirePasswordChanged] as const;

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };

  // ---- Admin-only org/admin creation ---------------------------------------
  router.post(
    '/admin/universities',
    ...authed,
    requirePermission('university:create'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(createUniversitySchema, req.body);
      const result = await createUniversity(config, body);
      audit(req, 'university:create', result.publicId);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/admin/companies',
    ...authed,
    requirePermission('company:create'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(createCompanySchema, req.body);
      const result = await createCompany(config, body);
      audit(req, 'company:create', result.publicId);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/admin/platform-admins',
    ...authed,
    requirePermission('platformAdmin:create'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(createPlatformAdminSchema, req.body);
      const result = await createPlatformAdmin(config, body);
      audit(req, 'platformAdmin:create', result.publicId);
      res.status(201).json(result);
    }),
  );

  // ---- University → Students (scoped to the actor's own university) --------
  router.post(
    '/universities/students',
    ...authed,
    requirePermission('student:create'),
    asyncHandler(async (req, res) => {
      const universityId = req.auth!.universityId;
      if (!universityId) throw new AppError(403, 'FORBIDDEN', 'No university in scope');
      const body = parseOrThrow(createStudentSchema, req.body);
      const result = await createStudent(config, universityId, body);
      audit(req, 'student:create', result.publicId);
      res.status(201).json(result);
    }),
  );

  router.get(
    '/universities/students',
    ...authed,
    requirePermission('student:list'),
    asyncHandler(async (req, res) => {
      const universityId = req.auth!.universityId;
      if (!universityId) throw new AppError(403, 'FORBIDDEN', 'No university in scope');
      res.status(200).json({ students: await listStudents(universityId) });
    }),
  );

  // ---- Company → Recruiters (scoped to the actor's own company) ------------
  router.post(
    '/companies/recruiters',
    ...authed,
    requirePermission('recruiter:create'),
    asyncHandler(async (req, res) => {
      const companyId = req.auth!.companyId;
      if (!companyId) throw new AppError(403, 'FORBIDDEN', 'No company in scope');
      const body = parseOrThrow(createRecruiterSchema, req.body);
      const result = await createRecruiter(config, companyId, body);
      audit(req, 'recruiter:create', result.publicId);
      res.status(201).json(result);
    }),
  );

  router.get(
    '/companies/recruiters',
    ...authed,
    requirePermission('recruiter:list'),
    asyncHandler(async (req, res) => {
      const companyId = req.auth!.companyId;
      if (!companyId) throw new AppError(403, 'FORBIDDEN', 'No company in scope');
      res.status(200).json({ recruiters: await listRecruiters(companyId) });
    }),
  );

  // ---- Account actions on a specific target (ownership-scoped) --------------
  // Resolver loads the target's org so the RBAC guard can enforce ownership.
  // Stashes the resolved target on res.locals for the handler.
  const resolveTarget = async (
    req: Request,
    res: import('express').Response,
  ): Promise<ResourceScope> => {
    const { publicId } = parseOrThrow(publicIdParam, req.params);
    const target = await loadTargetAccountScope(publicId);
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Account not found');
    res.locals.target = target;
    return { universityId: target.universityId, companyId: target.companyId };
  };

  router.post(
    '/accounts/:publicId/reset-password',
    ...authed,
    requirePermission('account:reset-password', resolveTarget),
    asyncHandler(async (req, res) => {
      const target = res.locals.target as { userId: string };
      const result = await resetAccountPassword(config, sessionStore, target.userId);
      audit(req, 'account:reset-password', req.params.publicId);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/accounts/:publicId/suspend',
    ...authed,
    requirePermission('account:suspend', resolveTarget),
    asyncHandler(async (req, res) => {
      const target = res.locals.target as { userId: string };
      await setAccountSuspended(sessionStore, target.userId, true);
      audit(req, 'account:suspend', req.params.publicId);
      res.status(200).json({ ok: true });
    }),
  );

  router.post(
    '/accounts/:publicId/reactivate',
    ...authed,
    requirePermission('account:reactivate', resolveTarget),
    asyncHandler(async (req, res) => {
      const target = res.locals.target as { userId: string };
      await setAccountSuspended(sessionStore, target.userId, false);
      audit(req, 'account:reactivate', req.params.publicId);
      res.status(200).json({ ok: true });
    }),
  );

  return router;
}
