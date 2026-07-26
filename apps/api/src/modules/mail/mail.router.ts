import { Router, type Request } from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  composeMailSchema,
  mailContactsQuerySchema,
  mailPageQuerySchema,
  mailPublicIdParam,
} from './mail.schema.js';
import {
  getMailDetail,
  listContacts,
  listInbox,
  listSent,
  sendMail,
  unreadCount,
} from './mail.service.js';

/**
 * Phase 5 — Internal Mailing. Every active user may use mail (`mail:send` /
 * `mail:read`); the directional recipient rules are enforced per-recipient by
 * `canMail` inside the service. Reads are strictly scoped to the caller.
 */
export function createMailRouter(deps: ApiDeps): Router {
  const { sessionStore, logger } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };

  // Compose & send.
  router.post(
    '/mail',
    ...guards,
    requirePermission('mail:send'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(composeMailSchema, req.body);
      const result = await sendMail(req.auth!, body);
      audit(req, 'mail:send', result.publicId);
      res.status(201).json(result);
    }),
  );

  // Inbox / Sent (paginated).
  router.get(
    '/mail/inbox',
    ...guards,
    requirePermission('mail:read'),
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(mailPageQuerySchema, req.query);
      res.status(200).json(await listInbox(req.auth!, query));
    }),
  );

  router.get(
    '/mail/sent',
    ...guards,
    requirePermission('mail:read'),
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(mailPageQuerySchema, req.query);
      res.status(200).json(await listSent(req.auth!, query));
    }),
  );

  // Unread count (nav badge).
  router.get(
    '/mail/unread-count',
    ...guards,
    requirePermission('mail:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ count: await unreadCount(req.auth!) });
    }),
  );

  // Addressable contacts (compose helper).
  router.get(
    '/mail/contacts',
    ...guards,
    requirePermission('mail:read'),
    asyncHandler(async (req, res) => {
      const { q } = parseOrThrow(mailContactsQuerySchema, req.query);
      res.status(200).json(await listContacts(req.auth!, q));
    }),
  );

  // Detail (sender or recipient only; marks read for a recipient).
  router.get(
    '/mail/:publicId',
    ...guards,
    requirePermission('mail:read'),
    asyncHandler(async (req, res) => {
      const { publicId } = parseOrThrow(mailPublicIdParam, req.params);
      res.status(200).json(await getMailDetail(req.auth!, publicId));
    }),
  );

  return router;
}
