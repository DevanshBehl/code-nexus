import { z } from 'zod';

/** Webinar route validation. Shared body schemas come from @code-nexus/types. */
export { webinarCreateSchema, webinarUpdateSchema, pollCreateSchema } from '@code-nexus/types';

export const webinarPublicIdParam = z.object({ publicId: z.string().uuid() });
export const webinarPollParam = z.object({
  publicId: z.string().uuid(),
  pollId: z.string().uuid(),
});
export const messagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
