import type { Request, Response, NextFunction } from 'express';
import { CSRF_COOKIE, CSRF_HEADER, generateCsrfToken } from '@code-nexus/auth';
import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection. For unsafe methods, the `X-CSRF-Token` header
 * must equal the (JS-readable) `cn_csrf` cookie. A fresh token cookie is issued
 * on safe requests so clients can read it before mutating.
 */
export function csrf(secure: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;

    if (!SAFE_METHODS.has(req.method)) {
      const headerToken = req.get(CSRF_HEADER);
      if (!cookieToken || !headerToken || headerToken !== cookieToken) {
        next(new AppError(403, 'CSRF', 'Invalid or missing CSRF token'));
        return;
      }
    }

    if (!cookieToken) {
      const token = generateCsrfToken();
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false, // must be readable by the client to echo in the header
        sameSite: 'lax',
        secure,
        path: '/',
      });
    }

    next();
  };
}
