import type { Request, Response, NextFunction } from 'express';
import type { ApiError } from '@code-nexus/types';
import { AppError } from '../errors.js';

/**
 * Centralized error handler. Renders the canonical envelope
 * `{ error: { code, message, requestId } }` and never leaks internal details
 * or stack traces to the client for 5xx errors.
 */
// Express identifies error handlers by their 4-arg signature, so `next` must stay.
/**
 * body-parser rejects an over-limit body before any route sees it, throwing its
 * own error rather than an AppError. Left untranslated it surfaces as a generic
 * 500, which tells an uploading client nothing actionable — so map it to the
 * canonical 413. (Phase 10 recording chunks are the first bounded binary body.)
 */
function fromBodyParser(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { type?: string; status?: number };
  if (e.type === 'entity.too.large' || e.status === 413) {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  return null;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError =
    err instanceof AppError
      ? err
      : (fromBodyParser(err) ??
        new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred', {
          expose: false,
        }));

  if (appError.statusCode >= 500) {
    req.log?.error({ err }, 'Unhandled error');
  } else {
    req.log?.warn({ code: appError.code }, appError.message);
  }

  const body: ApiError = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'Internal server error',
      requestId: req.requestId ?? 'unknown',
    },
  };

  res.status(appError.statusCode).json(body);
}
