import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from '@code-nexus/logger';
import { withRequestId } from '@code-nexus/logger';

/**
 * Assigns a correlation id to every request (honouring an inbound
 * `x-request-id` if present), echoes it back in the response header, and
 * attaches a request-scoped child logger. This id will flow across the future
 * distributed services.
 */
export function requestId(rootLogger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const id = incoming && incoming.trim().length > 0 ? incoming : randomUUID();
    req.requestId = id;
    req.log = withRequestId(rootLogger, id);
    res.setHeader('x-request-id', id);
    next();
  };
}
