import { Router } from 'express';
import type { Role } from '@code-nexus/types';
import type { Permission } from '@code-nexus/auth';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  adminDashboard,
  companyDashboard,
  recruiterDashboard,
  studentDashboard,
  universityDashboard,
} from './dashboard.service.js';

const DASHBOARD_PERMISSION: Record<Role, Permission> = {
  STUDENT: 'dashboard:read:student',
  UNIVERSITY: 'dashboard:read:university',
  COMPANY: 'dashboard:read:company',
  RECRUITER: 'dashboard:read:recruiter',
  ADMIN: 'dashboard:read:admin',
};

/** Load the role-scoped dashboard payload for the caller. */
async function loadForRole(auth: Express.AuthContext) {
  switch (auth.role) {
    case 'STUDENT':
      return studentDashboard(auth);
    case 'UNIVERSITY':
      return universityDashboard(auth);
    case 'COMPANY':
      return companyDashboard(auth);
    case 'RECRUITER':
      return recruiterDashboard(auth);
    case 'ADMIN':
      return adminDashboard();
  }
}

/**
 * Phase 3: real, role-scoped dashboard reads. `GET /dashboard` dispatches by the
 * caller's role; per-role paths remain individually permission-guarded so
 * cross-role access is a 403 (deny-by-default).
 */
export function createDashboardRouter(deps: ApiDeps): Router {
  const { sessionStore } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;

  const roleRoutes: { path: string; role: Role }[] = [
    { path: '/dashboard/student', role: 'STUDENT' },
    { path: '/dashboard/university', role: 'UNIVERSITY' },
    { path: '/dashboard/company', role: 'COMPANY' },
    { path: '/dashboard/recruiter', role: 'RECRUITER' },
    { path: '/dashboard/admin', role: 'ADMIN' },
  ];

  for (const route of roleRoutes) {
    router.get(
      route.path,
      ...guards,
      requirePermission(DASHBOARD_PERMISSION[route.role]),
      asyncHandler(async (req, res) => {
        res.status(200).json(await loadForRole(req.auth!));
      }),
    );
  }

  // Dispatch by the caller's own role.
  router.get(
    '/dashboard',
    ...guards,
    asyncHandler(async (req, res, next) => {
      const permission = DASHBOARD_PERMISSION[req.auth!.role];
      requirePermission(permission)(req, res, (err?: unknown) => {
        if (err) return next(err);
        loadForRole(req.auth!)
          .then((payload) => res.status(200).json(payload))
          .catch(next);
      });
    }),
  );

  return router;
}
