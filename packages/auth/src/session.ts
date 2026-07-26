import { randomBytes } from 'node:crypto';
import type { Role, UserStatus } from '@code-nexus/types';

export const SESSION_COOKIE = 'cn_session';
export const CSRF_COOKIE = 'cn_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Data persisted per session. Never contains the password hash. */
export interface SessionData {
  userId: string;
  publicId: string;
  role: Role;
  status: UserStatus;
  universityId?: string | null;
  companyId?: string | null;
  createdAt: number; // epoch ms
  lastSeenAt: number; // epoch ms
  ip?: string;
  userAgent?: string;
}

export interface SessionTtl {
  /** Hard cap on session age (seconds). */
  absoluteTtlSeconds: number;
  /** Sliding inactivity window (seconds). */
  idleTtlSeconds: number;
}

/**
 * Storage-agnostic session interface. `get` returns null (and evicts) when a
 * session is missing, idle-timed-out, or past its absolute expiry.
 */
export interface SessionStore {
  create(
    data: Omit<SessionData, 'createdAt' | 'lastSeenAt'>,
  ): Promise<{ id: string; data: SessionData }>;
  get(id: string): Promise<SessionData | null>;
  touch(id: string, lastSeenAt: number): Promise<void>;
  delete(id: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

/** Opaque, high-entropy identifier (URL-safe). */
export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** Random double-submit CSRF token. */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** True when the session has exceeded its idle window or absolute lifetime. */
export function isSessionExpired(data: SessionData, ttl: SessionTtl, now = Date.now()): boolean {
  if (now - data.lastSeenAt > ttl.idleTtlSeconds * 1000) return true;
  if (now - data.createdAt > ttl.absoluteTtlSeconds * 1000) return true;
  return false;
}
