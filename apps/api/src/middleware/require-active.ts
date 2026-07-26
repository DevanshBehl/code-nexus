import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors.js';

/**
 * Blocks a PENDING_PROFILE user from a dashboard until they complete onboarding.
 * Mount AFTER `requireAuth`. See prompt_phase2.md §9.
 */
export function requireActive(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.status !== 'ACTIVE') {
    next(new AppError(403, 'PROFILE_INCOMPLETE', 'Complete onboarding to continue'));
    return;
  }
  next();
}
