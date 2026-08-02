import { Router, type Request } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  attachQuestionSchema,
  contestCreateSchema,
  contestPublicIdParam,
  contestQuestionParam,
  contestUpdateSchema,
  runSubmitSchema,
} from './contests.schema.js';
import {
  attachQuestion,
  cancelContest,
  createContest,
  enqueueContestSubmission,
  finishContest,
  getContest,
  getContestQuestions,
  leaderboard,
  listContests,
  listContestSubmissions,
  publishContest,
  removeQuestion,
  startContest,
  updateContest,
} from './contests.service.js';

/**
 * Phase 7 — Contests. A contest is the Phase-6 execution pipeline run in a timed
 * window with a leaderboard. Run/Submit create a normal Submission (tagged with
 * contestId) and publish the same job — the API never executes code, the worker
 * is unchanged. Host writes are ownership-scoped in the service; timing/eligibility
 * are enforced server-side.
 */
export function createContestsRouter(deps: ApiDeps): Router {
  const { sessionStore, config, publisher, logger } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };
  const pid = (req: Request): string => parseOrThrow(contestPublicIdParam, req.params).publicId;

  // ---- Host: create / manage ------------------------------------------------
  router.post(
    '/contests',
    ...guards,
    requirePermission('contest:create'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(contestCreateSchema, req.body);
      const contest = await createContest(req.auth!, body);
      audit(req, 'contest:create', contest.publicId);
      res.status(201).json(contest);
    }),
  );

  router.get(
    '/contests',
    ...guards,
    requirePermission('contest:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ contests: await listContests(req.auth!) });
    }),
  );

  router.get(
    '/contests/:publicId',
    ...guards,
    requirePermission('contest:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getContest(req.auth!, pid(req)));
    }),
  );

  router.patch(
    '/contests/:publicId',
    ...guards,
    requirePermission('contest:manage'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(contestUpdateSchema, req.body);
      const contest = await updateContest(req.auth!, pid(req), body);
      audit(req, 'contest:update', contest.publicId);
      res.status(200).json(contest);
    }),
  );

  router.post(
    '/contests/:publicId/publish',
    ...guards,
    requirePermission('contest:manage'),
    asyncHandler(async (req, res) => {
      const contest = await publishContest(req.auth!, pid(req));
      audit(req, 'contest:publish', contest.publicId);
      res.status(200).json(contest);
    }),
  );

  router.post(
    '/contests/:publicId/cancel',
    ...guards,
    requirePermission('contest:manage'),
    asyncHandler(async (req, res) => {
      const contest = await cancelContest(req.auth!, pid(req));
      audit(req, 'contest:cancel', contest.publicId);
      res.status(200).json(contest);
    }),
  );

  router.post(
    '/contests/:publicId/questions',
    ...guards,
    requirePermission('contest:manage'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(attachQuestionSchema, req.body);
      await attachQuestion(req.auth!, pid(req), body);
      audit(req, 'contest:question:add', pid(req));
      res.status(201).json({ ok: true });
    }),
  );

  router.delete(
    '/contests/:publicId/questions/:slug',
    ...guards,
    requirePermission('contest:manage'),
    asyncHandler(async (req, res) => {
      const { publicId, slug } = parseOrThrow(contestQuestionParam, req.params);
      await removeQuestion(req.auth!, publicId, slug);
      audit(req, 'contest:question:remove', publicId);
      res.status(200).json({ ok: true });
    }),
  );

  // ---- Participate ----------------------------------------------------------
  router.get(
    '/contests/:publicId/questions',
    ...guards,
    requirePermission('contest:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ questions: await getContestQuestions(req.auth!, pid(req)) });
    }),
  );

  // Begin (or resume) the single attempt — one-way, timer starts.
  router.post(
    '/contests/:publicId/start',
    ...guards,
    requirePermission('contest:participate'),
    asyncHandler(async (req, res) => {
      const result = await startContest(req.auth!, pid(req));
      audit(req, 'contest:start', pid(req));
      res.status(200).json(result);
    }),
  );

  // Finalize the attempt — locks submissions + re-entry.
  router.post(
    '/contests/:publicId/finish',
    ...guards,
    requirePermission('contest:participate'),
    asyncHandler(async (req, res) => {
      const result = await finishContest(req.auth!, pid(req));
      audit(req, 'contest:finish', pid(req));
      res.status(200).json(result);
    }),
  );

  router.post(
    '/contests/:publicId/questions/:slug/run',
    ...guards,
    requirePermission('contest:submit'),
    asyncHandler(async (req, res) => {
      const { publicId, slug } = parseOrThrow(contestQuestionParam, req.params);
      const body = parseOrThrow(runSubmitSchema, req.body);
      const result = await enqueueContestSubmission(
        { config, publisher },
        req.auth!,
        publicId,
        slug,
        'RUN',
        body,
      );
      audit(req, 'contest:run', result.submissionPublicId);
      res.status(202).json(result);
    }),
  );

  router.post(
    '/contests/:publicId/questions/:slug/submit',
    ...guards,
    requirePermission('contest:submit'),
    asyncHandler(async (req, res) => {
      const { publicId, slug } = parseOrThrow(contestQuestionParam, req.params);
      const body = parseOrThrow(runSubmitSchema, req.body);
      const result = await enqueueContestSubmission(
        { config, publisher },
        req.auth!,
        publicId,
        slug,
        'SUBMIT',
        body,
      );
      audit(req, 'contest:submit', result.submissionPublicId);
      res.status(202).json(result);
    }),
  );

  // The caller's own verdict history for this contest (scoped in the service).
  router.get(
    '/contests/:publicId/submissions',
    ...guards,
    requirePermission('contest:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ submissions: await listContestSubmissions(req.auth!, pid(req)) });
    }),
  );

  // ---- Leaderboard ----------------------------------------------------------
  router.get(
    '/contests/:publicId/leaderboard',
    ...guards,
    requirePermission('contest:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await leaderboard(req.auth!, pid(req)));
    }),
  );

  return router;
}
