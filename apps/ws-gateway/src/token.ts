import { verifyRtToken } from '@code-nexus/auth';
import type { RtTokenPayload } from '@code-nexus/types';

/** Pull the `token` query param out of a WebSocket upgrade URL. */
export function tokenFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get('token');
}

/** Verify a connection's RT token (HMAC + expiry). Returns null if invalid. */
export function authenticate(
  url: string | undefined,
  secret: string,
  now: number = Date.now(),
): RtTokenPayload | null {
  const token = tokenFromUrl(url);
  if (!token) return null;
  return verifyRtToken(token, secret, now);
}
