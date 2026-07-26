import { z } from 'zod';

/** Contest route validation. Shared body schemas come from @code-nexus/types. */
export {
  contestCreateSchema,
  contestUpdateSchema,
  attachQuestionSchema,
  runSubmitSchema,
} from '@code-nexus/types';

export const contestPublicIdParam = z.object({ publicId: z.string().uuid() });
export const contestQuestionParam = z.object({
  publicId: z.string().uuid(),
  slug: z.string().trim().min(1).max(200),
});
