import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors.js';

/** Terminal 404 handler for unmatched routes — forwards to the error handler. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Cannot ${req.method} ${req.path}`));
}
