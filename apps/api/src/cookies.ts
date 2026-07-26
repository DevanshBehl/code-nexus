import type { Response } from 'express';
import { CSRF_COOKIE, SESSION_COOKIE } from '@code-nexus/auth';
import type { AppConfig } from '@code-nexus/config';

/** Set the signed, httpOnly session cookie. */
export function setSessionCookie(res: Response, sessionId: string, config: AppConfig): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: config.SESSION_ABSOLUTE_TTL_SECONDS * 1000,
  });
}

/** Clear both auth cookies on logout. */
export function clearAuthCookies(res: Response, config: AppConfig): void {
  const secure = config.NODE_ENV === 'production';
  res.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure,
  });
  res.clearCookie(CSRF_COOKIE, { path: '/', sameSite: 'lax', secure });
}
