import { z } from 'zod';

/** Arena route validation. Shared body/query schemas come from @code-nexus/types. */
export {
  runSubmitSchema,
  questionListQuerySchema,
  submissionsQuerySchema,
  heatmapQuerySchema,
} from '@code-nexus/types';

export const questionSlugParam = z.object({ slug: z.string().min(1).max(200) });
export const submissionPublicIdParam = z.object({ publicId: z.string().uuid() });
