import cors from 'cors';
import type { RequestHandler } from 'express';
import type { AppConfig } from '@code-nexus/config';

/**
 * Configured CORS: allow only the configured web origin(s), with credentials so
 * the session/CSRF cookies flow. In dev the Vite proxy makes calls same-origin,
 * so this mainly matters when web and api are served on different origins.
 */
export function corsMiddleware(config: AppConfig): RequestHandler {
  const allowed = new Set(config.WEB_ORIGIN);
  return cors({
    origin(origin, cb) {
      // Same-origin / non-browser (no Origin header) requests are allowed.
      if (!origin || allowed.has(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });
}
