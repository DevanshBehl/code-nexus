import { Router, type Request } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  feedbackCreateSchema,
  interviewCreateSchema,
  interviewEndSchema,
  interviewPublicIdParam,
  interviewQuestionBankQuerySchema,
  interviewQuestionSetSchema,
  interviewRunSchema,
  interviewUpdateSchema,
} from './interviews.schema.js';
import {
  cancelInterview,
  createInterview,
  endInterview,
  getFeedback,
  getInterview,
  goLiveInterview,
  listInterviews,
  mintRtToken,
  questionBank,
  rtcConfig,
  runInterview,
  setInterviewQuestion,
  submitFeedback,
  updateInterview,
  type InterviewCtx,
} from './interviews.service.js';

/**
 * Phase 9 — Live Interviews. The api owns scheduling + lifecycle + rt-token +
 * ICE config + feedback + run (Phase-6 pipeline reuse). It opens NO WebSocket and
 * touches NO media bytes: the live socket is the ws-gateway's job (extended to
 * serve interview rooms), and WebRTC media flows peer-to-peer. Host-originated
 * events (interview ended) are published to Redis for the gateway to relay.
 */
export function createInterviewsRouter(deps: ApiDeps): Router {
  const { sessionStore, config, roomBus, publisher, logger } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;
  const ctx: InterviewCtx = { config, roomBus, publisher };

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };
  const pid = (req: Request): string => parseOrThrow(interviewPublicIdParam, req.params).publicId;

  // ---- Host: schedule / manage ----------------------------------------------
  router.post(
    '/interviews',
    ...guards,
    requirePermission('interview:schedule'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(interviewCreateSchema, req.body);
      const interview = await createInterview(ctx, req.auth!, body);
      audit(req, 'interview:create', interview.publicId);
      res.status(201).json(interview);
    }),
  );

  router.get(
    '/interviews',
    ...guards,
    requirePermission('interview:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ interviews: await listInterviews(req.auth!) });
    }),
  );

  router.get(
    '/interviews/:publicId',
    ...guards,
    requirePermission('interview:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getInterview(req.auth!, pid(req)));
    }),
  );

  router.patch(
    '/interviews/:publicId',
    ...guards,
    requirePermission('interview:manage'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(interviewUpdateSchema, req.body);
      const interview = await updateInterview(req.auth!, pid(req), body);
      audit(req, 'interview:update', interview.publicId);
      res.status(200).json(interview);
    }),
  );

  router.post(
    '/interviews/:publicId/cancel',
    ...guards,
    requirePermission('interview:manage'),
    asyncHandler(async (req, res) => {
      const interview = await cancelInterview(req.auth!, pid(req));
      audit(req, 'interview:cancel', interview.publicId);
      res.status(200).json(interview);
    }),
  );

  router.post(
    '/interviews/:publicId/go-live',
    ...guards,
    requirePermission('interview:manage'),
    asyncHandler(async (req, res) => {
      const interview = await goLiveInterview(req.auth!, pid(req));
      audit(req, 'interview:go-live', interview.publicId);
      res.status(200).json(interview);
    }),
  );

  router.post(
    '/interviews/:publicId/end',
    ...guards,
    requirePermission('interview:manage'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(interviewEndSchema, req.body);
      const interview = await endInterview(ctx, req.auth!, pid(req), body);
      audit(req, 'interview:end', interview.publicId);
      res.status(200).json(interview);
    }),
  );

  // ---- Live question bank (interviewer picks the problem mid-call) ----------
  router.get(
    '/interviews/:publicId/question-bank',
    ...guards,
    requirePermission('interview:manage'),
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(interviewQuestionBankQuerySchema, req.query);
      res.status(200).json(await questionBank(req.auth!, pid(req), query));
    }),
  );

  router.post(
    '/interviews/:publicId/question',
    ...guards,
    requirePermission('interview:manage'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(interviewQuestionSetSchema, req.body);
      const result = await setInterviewQuestion(ctx, req.auth!, pid(req), body);
      audit(req, 'interview:question', result.question?.slug ?? 'cleared');
      res.status(200).json(result);
    }),
  );

  // ---- Real-time token + ICE config (participants only) ---------------------
  router.get(
    '/interviews/:publicId/rt-token',
    ...guards,
    requirePermission('interview:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await mintRtToken(ctx, req.auth!, pid(req)));
    }),
  );

  router.get(
    '/interviews/:publicId/rtc-config',
    ...guards,
    requirePermission('interview:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await rtcConfig(ctx, req.auth!, pid(req)));
    }),
  );

  // ---- Live code execution (candidate; reuse the Phase-6 pipeline) ----------
  router.post(
    '/interviews/:publicId/run',
    ...guards,
    requirePermission('interview:attend'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(interviewRunSchema, req.body);
      const result = await runInterview(ctx, req.auth!, pid(req), body);
      audit(req, 'interview:run', result.submissionPublicId);
      res.status(202).json(result);
    }),
  );

  // ---- Feedback (interviewer; private) --------------------------------------
  router.post(
    '/interviews/:publicId/feedback',
    ...guards,
    requirePermission('interview:feedback'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(feedbackCreateSchema, req.body);
      await submitFeedback(req.auth!, pid(req), body);
      audit(req, 'interview:feedback', pid(req));
      res.status(201).json({ ok: true });
    }),
  );

  router.get(
    '/interviews/:publicId/feedback',
    ...guards,
    requirePermission('interview:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getFeedback(req.auth!, pid(req)));
    }),
  );

  return router;
}
