import { Router, type Request, type Response } from 'express';
import { prisma } from '@code-nexus/db';
import type { HealthResponse } from '@code-nexus/types';

export const healthRouter: Router = Router();

/** Liveness: the process is up and serving. */
healthRouter.get('/health', (_req: Request, res: Response) => {
  const body: HealthResponse = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
  res.status(200).json(body);
});

/** Readiness: the database is reachable. 200 if reachable, 503 otherwise. */
healthRouter.get('/health/db', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', db: 'reachable' });
  } catch (err) {
    req.log?.error({ err }, 'Database health check failed');
    res.status(503).json({
      error: {
        code: 'DB_UNREACHABLE',
        message: 'Database is not reachable',
        requestId: req.requestId ?? 'unknown',
      },
    });
  }
});
