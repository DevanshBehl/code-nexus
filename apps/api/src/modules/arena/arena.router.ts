import { Router, type Request } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  heatmapQuerySchema,
  questionListQuerySchema,
  questionSlugParam,
  runSubmitSchema,
  submissionPublicIdParam,
  submissionsQuerySchema,
} from './arena.schema.js';
import {
  arenaStats,
  enqueueRunOrSubmit,
  getQuestion,
  getSubmission,
  heatmap,
  listQuestions,
  listSubmissions,
} from './arena.service.js';

/**
 * Phase 6 — Code Arena. The API only reads the bank and ENQUEUES run/submit jobs
 * (via the injected publisher); it NEVER executes code. Everything is
 * student-scoped. Hidden testcases are never serialized (see the service).
 */
export function createArenaRouter(deps: ApiDeps): Router {
  const { sessionStore, config, publisher, logger } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };

  // ---- Questions -----------------------------------------------------------
  router.get(
    '/arena/questions',
    ...guards,
    requirePermission('arena:read'),
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(questionListQuerySchema, req.query);
      res.status(200).json(await listQuestions(req.auth!, query));
    }),
  );

  router.get(
    '/arena/questions/:slug',
    ...guards,
    requirePermission('arena:read'),
    asyncHandler(async (req, res) => {
      const { slug } = parseOrThrow(questionSlugParam, req.params);
      res.status(200).json(await getQuestion(req.auth!, slug));
    }),
  );

  // ---- Run / Submit (enqueue only) -----------------------------------------
  router.post(
    '/arena/questions/:slug/run',
    ...guards,
    requirePermission('arena:submit'),
    asyncHandler(async (req, res) => {
      const { slug } = parseOrThrow(questionSlugParam, req.params);
      const body = parseOrThrow(runSubmitSchema, req.body);
      const result = await enqueueRunOrSubmit({ config, publisher }, req.auth!, slug, 'RUN', body);
      audit(req, 'arena:run', result.submissionPublicId);
      res.status(202).json(result);
    }),
  );

  router.post(
    '/arena/questions/:slug/submit',
    ...guards,
    requirePermission('arena:submit'),
    asyncHandler(async (req, res) => {
      const { slug } = parseOrThrow(questionSlugParam, req.params);
      const body = parseOrThrow(runSubmitSchema, req.body);
      const result = await enqueueRunOrSubmit(
        { config, publisher },
        req.auth!,
        slug,
        'SUBMIT',
        body,
      );
      audit(req, 'arena:submit', result.submissionPublicId);
      res.status(202).json(result);
    }),
  );

  // ---- Submission reads (owner-scoped) -------------------------------------
  router.get(
    '/arena/submissions',
    ...guards,
    requirePermission('arena:read'),
    asyncHandler(async (req, res) => {
      const { slug } = parseOrThrow(submissionsQuerySchema, req.query);
      res.status(200).json({ submissions: await listSubmissions(req.auth!, slug) });
    }),
  );

  router.get(
    '/arena/submissions/:publicId',
    ...guards,
    requirePermission('arena:read'),
    asyncHandler(async (req, res) => {
      const { publicId } = parseOrThrow(submissionPublicIdParam, req.params);
      res.status(200).json(await getSubmission(req.auth!, publicId));
    }),
  );

  // ---- Heatmap + stats -----------------------------------------------------
  router.get(
    '/arena/heatmap',
    ...guards,
    requirePermission('arena:read'),
    asyncHandler(async (req, res) => {
      const { year } = parseOrThrow(heatmapQuerySchema, req.query);
      res.status(200).json(await heatmap(req.auth!, year ?? new Date().getUTCFullYear()));
    }),
  );

  router.get(
    '/arena/stats',
    ...guards,
    requirePermission('arena:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await arenaStats(req.auth!));
    }),
  );

  return router;
}
