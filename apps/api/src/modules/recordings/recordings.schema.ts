import { z } from 'zod';

/** Recording route validation. Shared body schemas come from @code-nexus/types. */
export {
  recordingStartSchema,
  recordingChunkSchema,
  recordingCompleteSchema,
} from '@code-nexus/types';

export const recordingPublicIdParam = z.object({ publicId: z.string().uuid() });

export const interviewPublicIdParam = z.object({ interviewPublicId: z.string().uuid() });

export const streamParams = z.object({
  publicId: z.string().uuid(),
  ordinal: z.coerce.number().int().min(0),
});
