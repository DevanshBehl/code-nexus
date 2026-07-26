import { Router, type Request } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  messagesQuery,
  pollCreateSchema,
  webinarCreateSchema,
  webinarPollParam,
  webinarPublicIdParam,
  webinarUpdateSchema,
} from './webinars.schema.js';
import {
  cancelWebinar,
  closePoll,
  createPoll,
  createWebinar,
  endWebinar,
  getAttendance,
  getWebinar,
  goLiveWebinar,
  listMessages,
  listPolls,
  listWebinars,
  mintRtToken,
  publishWebinar,
  updateWebinar,
  type WebinarCtx,
} from './webinars.service.js';

/**
 * Phase 8 — Webinars. The api owns CRUD + lifecycle + polls + history/attendance
 * reads + minting short-lived RT tokens. It NEVER opens a WebSocket and NEVER
 * touches media bytes: the live socket is the ws-gateway's job; media is HLS out
 * of band via the pluggable media provider. Host-originated live events (poll
 * opened/closed, webinar ended) are published to Redis for the gateway to relay.
 */
export function createWebinarsRouter(deps: ApiDeps): Router {
  const { sessionStore, config, roomBus, logger } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;
  const ctx: WebinarCtx = { config, roomBus };

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };
  const pid = (req: Request): string => parseOrThrow(webinarPublicIdParam, req.params).publicId;

  // ---- Host: create / manage ------------------------------------------------
  router.post(
    '/webinars',
    ...guards,
    requirePermission('webinar:create'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(webinarCreateSchema, req.body);
      const webinar = await createWebinar(ctx, req.auth!, body);
      audit(req, 'webinar:create', webinar.publicId);
      res.status(201).json(webinar);
    }),
  );

  router.get(
    '/webinars',
    ...guards,
    requirePermission('webinar:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ webinars: await listWebinars(req.auth!) });
    }),
  );

  router.get(
    '/webinars/:publicId',
    ...guards,
    requirePermission('webinar:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getWebinar(ctx, req.auth!, pid(req)));
    }),
  );

  router.patch(
    '/webinars/:publicId',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(webinarUpdateSchema, req.body);
      const webinar = await updateWebinar(ctx, req.auth!, pid(req), body);
      audit(req, 'webinar:update', webinar.publicId);
      res.status(200).json(webinar);
    }),
  );

  router.post(
    '/webinars/:publicId/publish',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      const webinar = await publishWebinar(ctx, req.auth!, pid(req));
      audit(req, 'webinar:publish', webinar.publicId);
      res.status(200).json(webinar);
    }),
  );

  router.post(
    '/webinars/:publicId/cancel',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      const webinar = await cancelWebinar(ctx, req.auth!, pid(req));
      audit(req, 'webinar:cancel', webinar.publicId);
      res.status(200).json(webinar);
    }),
  );

  router.post(
    '/webinars/:publicId/go-live',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      const webinar = await goLiveWebinar(ctx, req.auth!, pid(req));
      audit(req, 'webinar:go-live', webinar.publicId);
      res.status(200).json(webinar);
    }),
  );

  router.post(
    '/webinars/:publicId/end',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      const webinar = await endWebinar(ctx, req.auth!, pid(req));
      audit(req, 'webinar:end', webinar.publicId);
      res.status(200).json(webinar);
    }),
  );

  // ---- Real-time token (host or eligible LIVE-webinar student) --------------
  router.get(
    '/webinars/:publicId/rt-token',
    ...guards,
    requirePermission('webinar:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await mintRtToken(ctx, req.auth!, pid(req)));
    }),
  );

  // ---- Chat history ---------------------------------------------------------
  router.get(
    '/webinars/:publicId/messages',
    ...guards,
    requirePermission('webinar:read'),
    asyncHandler(async (req, res) => {
      const { limit } = parseOrThrow(messagesQuery, req.query);
      res.status(200).json(await listMessages(req.auth!, pid(req), limit));
    }),
  );

  // ---- Polls ----------------------------------------------------------------
  router.get(
    '/webinars/:publicId/polls',
    ...guards,
    requirePermission('webinar:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await listPolls(req.auth!, pid(req)));
    }),
  );

  router.post(
    '/webinars/:publicId/polls',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(pollCreateSchema, req.body);
      const poll = await createPoll(ctx, req.auth!, pid(req), body);
      audit(req, 'webinar:poll:open', poll.publicId);
      res.status(201).json(poll);
    }),
  );

  router.post(
    '/webinars/:publicId/polls/:pollId/close',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      const { publicId, pollId } = parseOrThrow(webinarPollParam, req.params);
      const poll = await closePoll(ctx, req.auth!, publicId, pollId);
      audit(req, 'webinar:poll:close', pollId);
      res.status(200).json(poll);
    }),
  );

  // ---- Attendance (host only) -----------------------------------------------
  router.get(
    '/webinars/:publicId/attendance',
    ...guards,
    requirePermission('webinar:manage'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getAttendance(req.auth!, pid(req)));
    }),
  );

  return router;
}
