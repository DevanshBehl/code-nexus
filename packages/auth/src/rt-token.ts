import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RtTokenPayload } from '@code-nexus/types';

/**
 * Short-lived real-time (RT) tokens for the ws-gateway (Phase 8).
 *
 * The api MINTS a token (it holds the session + authorizes the caller for a
 * specific webinar); the ws-gateway VERIFIES it with the same `RT_TOKEN_SECRET`.
 * This keeps the gateway stateless about sessions — it trusts a signed, expiring
 * claim rather than reading the session store. Format is a compact, URL-safe
 * `<base64url(json)>.<base64url(hmac-sha256)>` (a minimal JWT-like token; we roll
 * our own to avoid a dependency for one internal use).
 */

const enc = (buf: Buffer): string => buf.toString('base64url');

function sign(body: string, secret: string): string {
  return enc(createHmac('sha256', secret).update(body).digest());
}

/** Mint a token valid for `ttlSeconds` from now. */
export function signRtToken(
  payload: Omit<RtTokenPayload, 'exp'>,
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): { token: string; exp: number } {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const full: RtTokenPayload = { ...payload, exp };
  const body = enc(Buffer.from(JSON.stringify(full), 'utf8'));
  return { token: `${body}.${sign(body, secret)}`, exp };
}

/**
 * Verify signature + expiry and return the payload, or null if the token is
 * malformed, tampered, or expired. Never throws.
 */
export function verifyRtToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): RtTokenPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: RtTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RtTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
  return payload;
}
