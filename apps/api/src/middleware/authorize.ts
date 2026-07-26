import type { Request, Response, NextFunction } from 'express';
import { can, type Permission, type ResourceScope } from '@code-nexus/auth';
import { AppError } from '../errors.js';

/**
 * Resolves the ownership scope of a targeted resource (e.g. loads the account
 * addressed by `:publicId`). May throw an AppError (e.g. 404). May stash data on
 * `res.locals` for the handler to reuse.
 */
export type ResourceResolver = (req: Request, res: Response) => Promise<ResourceScope>;

/**
 * Deny-by-default authorization guard. Requires `req.auth` (mount `requireAuth`
 * first) and checks the permission via the RBAC policy, with optional
 * ownership scoping.
 */
export function requirePermission(permission: Permission, resolveScope?: ResourceResolver) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const actor = req.auth;
      if (!actor) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

      const scope = resolveScope ? await resolveScope(req, res) : undefined;
      if (!can(actor, permission, scope)) {
        throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      }
    })().then(() => next(), next);
  };
}
