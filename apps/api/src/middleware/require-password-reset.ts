import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors.js';

/**
 * Blocks a first-login user (mustResetPassword) from everything except changing
 * their password / logging out. Mount AFTER `requireAuth`, and NOT on the
 * password-change or logout routes.
 */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.mustResetPassword) {
    next(new AppError(403, 'PASSWORD_RESET_REQUIRED', 'You must change your password first'));
    return;
  }
  next();
}
