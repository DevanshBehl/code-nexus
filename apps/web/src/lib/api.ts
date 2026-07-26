import { CSRF_COOKIE_NAME } from './constants.ts';

const BASE = '/api';

export interface ApiErrorShape {
  code: string;
  message: string;
  requestId?: string;
}

/** Typed error thrown by the API client; carries the canonical error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
  }
}

/**
 * Absolute URL for a path the api handed back.
 *
 * The api roots its own URLs at ITS origin (`/recordings/…/stream/0`), but the
 * browser only ever talks to the web origin, where that same path is the SPA
 * itself — a `<video>` pointed at it silently loads index.html. Anything already
 * absolute (an S3 signed URL) is passed through untouched.
 */
export function apiUrl(path: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `${BASE}${path}`;
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // Double-submit CSRF: echo the cn_csrf cookie on every mutating request.
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include', // send/receive the httpOnly session cookie
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const err = (data?.error as ApiErrorShape) ?? { code: 'UNKNOWN', message: res.statusText };
    throw new ApiError(res.status, err);
  }
  return data as T;
}

/**
 * POST raw bytes (Phase 10 recording chunks). Deliberately separate from
 * `request`: the body must NOT be JSON-stringified, and the Content-Type is the
 * media type rather than application/json. CSRF and cookies work the same.
 */
async function requestBinary<T>(path: string, body: Blob, contentType: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  const csrf = readCookie(CSRF_COOKIE_NAME);
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data?.error as ApiErrorShape) ?? { code: 'UNKNOWN', message: res.statusText };
    throw new ApiError(res.status, err);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  postBinary: <T>(path: string, body: Blob, contentType: string) =>
    requestBinary<T>(path, body, contentType),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
