import { Router } from 'express';
import type { CalendarEventsResponse } from '@code-nexus/types';
import { calendarRangeSchema } from '@code-nexus/types';
import type { ApiDeps } from '../../deps.js';
import { asyncHandler } from '../../async-handler.js';
import { parseOrThrow } from '../../validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requirePasswordChanged } from '../../middleware/require-password-reset.js';
import { requireActive } from '../../middleware/require-active.js';
import { listCalendarEvents } from './calendar.service.js';

/**
 * Calendar events (prompt_phase3.md §8). Phase 4 populates real DRIVE events
 * (apply deadlines), role-scoped, with zero UI change on the client.
 * TODO(phase7): source contest events into the same typed contract.
 */
export function createCalendarRouter(deps: ApiDeps): Router {
  const { sessionStore } = deps;
  const router = Router();
  const guards = [requireAuth(sessionStore), requirePasswordChanged, requireActive] as const;

  router.get(
    '/calendar/events',
    ...guards,
    asyncHandler(async (req, res) => {
      const range = parseOrThrow(calendarRangeSchema, req.query);
      const events = await listCalendarEvents(req.auth!, range);
      const body: CalendarEventsResponse = { events };
      res.status(200).json(body);
    }),
  );

  return router;
}
