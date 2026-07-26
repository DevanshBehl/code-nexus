import { z } from 'zod';

/** Interview route validation. Shared body schemas come from @code-nexus/types. */
export {
  interviewCreateSchema,
  interviewUpdateSchema,
  interviewEndSchema,
  feedbackCreateSchema,
  interviewRunSchema,
  interviewQuestionSetSchema,
  interviewQuestionBankQuerySchema,
} from '@code-nexus/types';

export const interviewPublicIdParam = z.object({ publicId: z.string().uuid() });
