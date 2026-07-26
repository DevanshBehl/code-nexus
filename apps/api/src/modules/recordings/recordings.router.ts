import { Router, type Request } from 'express';
import express from 'express';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import {
  interviewPublicIdParam,
  recordingChunkSchema,
  recordingCompleteSchema,
  recordingPublicIdParam,
  recordingStartSchema,
  streamParams,
} from './recordings.schema.js';
import {
  appendChunk,
  completeRecording,
  deleteRecording,
  getInterviewEvents,
  getPlayback,
  getRecording,
  getSegmentForStream,
  listRecordings,
  startRecording,
  type RecordingCtx,
} from './recordings.service.js';
import { parseRange } from './recordings.storage.js';

/**
 * Phase 10 — recording upload, review and playback.
 *
 * The upload path is the ONE place media bytes traverse the api, and it is
 * store-and-forward rather than a live media path: a browser posts finished
 * chunks, the api authorizes and hands them to the storage driver. Live media
 * remains peer-to-peer and never touches this process.
 */
export function createRecordingsRouter(deps: ApiDeps): Router {
  const { sessionStore, config, logger, recordingStorage } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;
  const ctx: RecordingCtx = { config, storage: recordingStorage };

  const audit = (req: Request, action: string, target?: string): void => {
    logger.info(
      { requestId: req.requestId, actor: req.auth?.publicId, action, target, outcome: 'success' },
      action,
    );
  };
  const ivId = (req: Request): string =>
    parseOrThrow(interviewPublicIdParam, req.params).interviewPublicId;
  const recId = (req: Request): string => parseOrThrow(recordingPublicIdParam, req.params).publicId;

  // ---- Capture (elected interviewer only) ----------------------------------
  router.post(
    '/recordings/:interviewPublicId/start',
    ...guards,
    requirePermission('recording:upload'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(recordingStartSchema, req.body);
      const result = await startRecording(ctx, req.auth!, ivId(req), body);
      audit(req, 'recording:start', result.recordingPublicId);
      res.status(201).json(result);
    }),
  );

  /**
   * The chunk body is raw binary, so this route opts out of the JSON parser and
   * caps the payload at the configured limit — Express rejects anything larger
   * before it reaches memory.
   *
   * `type` is a predicate rather than a wildcard media type on purpose.
   * MediaRecorder labels its blobs `video/webm;codecs=vp9,opus`, and that
   * unquoted comma is not a legal media-type parameter — `type-is` throws while
   * parsing the header and reports NO match, wildcard included. The body would
   * then be left unread and EVERY chunk would arrive empty, which is exactly how
   * a finished interview ends up stored as a zero-segment FAILED recording. This
   * route is binary by definition, so take the body whatever the header claims.
   */
  router.post(
    '/recordings/:interviewPublicId/chunk',
    ...guards,
    requirePermission('recording:upload'),
    express.raw({ type: () => true, limit: config.RECORDING_MAX_CHUNK_BYTES }),
    asyncHandler(async (req, res) => {
      const meta = parseOrThrow(recordingChunkSchema, req.query);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await appendChunk(ctx, req.auth!, ivId(req), meta, body);
      res.status(202).json(result);
    }),
  );

  router.post(
    '/recordings/:interviewPublicId/complete',
    ...guards,
    requirePermission('recording:upload'),
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(recordingCompleteSchema, req.body ?? {});
      const result = await completeRecording(req.auth!, ivId(req), body);
      audit(req, 'recording:complete', ivId(req));
      res.status(200).json(result);
    }),
  );

  // ---- Review --------------------------------------------------------------
  router.get(
    '/recordings',
    ...guards,
    requirePermission('recording:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json({ recordings: await listRecordings(req.auth!) });
    }),
  );

  router.get(
    '/recordings/:publicId',
    ...guards,
    requirePermission('recording:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getRecording(req.auth!, recId(req)));
    }),
  );

  router.get(
    '/recordings/:publicId/playback',
    ...guards,
    requirePermission('recording:read'),
    asyncHandler(async (req, res) => {
      const result = await getPlayback(ctx, req.auth!, recId(req));
      audit(req, 'recording:playback', recId(req));
      res.status(200).json(result);
    }),
  );

  /**
   * Stream one segment (the `local` driver's playback path).
   *
   * Range support is not optional: a video element scrubs by asking for byte
   * windows, so without a 206 the player can start but never seek.
   */
  router.get(
    '/recordings/:publicId/stream/:ordinal',
    ...guards,
    requirePermission('recording:read'),
    asyncHandler(async (req, res) => {
      const { publicId, ordinal } = parseOrThrow(streamParams, req.params);
      const { storage, storageKey, mimeType } = await getSegmentForStream(
        ctx,
        req.auth!,
        publicId,
        ordinal,
      );
      const size = await storage.size(storageKey);
      const range = parseRange(req.headers.range, size);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      // Recorded media is personal data — never let a shared cache hold it.
      res.setHeader('Cache-Control', 'private, no-store');

      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
      } else {
        res.status(200);
        res.setHeader('Content-Length', String(size));
      }
      const stream = await storage.getStream(storageKey, range ?? undefined);
      stream.pipe(res);
    }),
  );

  router.delete(
    '/recordings/:publicId',
    ...guards,
    requirePermission('recording:delete'),
    asyncHandler(async (req, res) => {
      const result = await deleteRecording(ctx, req.auth!, recId(req));
      audit(req, 'recording:delete', recId(req));
      res.status(200).json(result);
    }),
  );

  // ---- Timeline ------------------------------------------------------------
  router.get(
    '/interviews/:interviewPublicId/events',
    ...guards,
    requirePermission('recording:read'),
    asyncHandler(async (req, res) => {
      res.status(200).json(await getInterviewEvents(req.auth!, ivId(req)));
    }),
  );

  return router;
}
