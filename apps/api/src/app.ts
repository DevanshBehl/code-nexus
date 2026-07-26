import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { ApiDeps } from './deps.js';
import { requestId } from './middleware/request-id.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import { csrf } from './middleware/csrf.js';
import { corsMiddleware } from './middleware/cors.js';
import { healthRouter } from './routes/health.js';
import { createAuthRouter } from './modules/auth/auth.router.js';
import { createProvisioningRouter } from './modules/provisioning/provisioning.router.js';
import { createProfileRouter } from './modules/profile/profile.router.js';
import { createDashboardRouter } from './modules/dashboard/dashboard.router.js';
import { createCalendarRouter } from './modules/calendar/calendar.router.js';
import { createDrivesRouter } from './modules/drives/drives.router.js';
import { createApplicationsRouter } from './modules/applications/applications.router.js';
import { createMailRouter } from './modules/mail/mail.router.js';
import { createArenaRouter } from './modules/arena/arena.router.js';
import { createContestsRouter } from './modules/contests/contests.router.js';
import { createWebinarsRouter } from './modules/webinars/webinars.router.js';
import { createInterviewsRouter } from './modules/interviews/interviews.router.js';
import { createRecordingsRouter } from './modules/recordings/recordings.router.js';

/**
 * Express application factory. Wires middleware and routes but does NOT listen —
 * kept side-effect-free so it can be exercised directly in tests. Dependencies
 * (logger, config, sessionStore) are injected so tests can supply an
 * InMemorySessionStore.
 */
export function createApp(deps: ApiDeps): Express {
  const { logger, config } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct req.ip behind a proxy (rate-limit keys)
  app.use(corsMiddleware(config));
  app.use(express.json());
  app.use(cookieParser(config.SESSION_COOKIE_SECRET));
  app.use(requestId(logger));
  app.use(csrf(config.NODE_ENV === 'production'));

  app.use(healthRouter);
  app.use(createAuthRouter(deps));
  app.use(createProvisioningRouter(deps));
  app.use(createProfileRouter(deps));
  app.use(createDashboardRouter(deps));
  app.use(createCalendarRouter(deps));
  app.use(createDrivesRouter(deps));
  app.use(createApplicationsRouter(deps));
  app.use(createMailRouter(deps));
  app.use(createArenaRouter(deps));
  app.use(createContestsRouter(deps));
  app.use(createWebinarsRouter(deps));
  app.use(createInterviewsRouter(deps));
  app.use(createRecordingsRouter(deps));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
