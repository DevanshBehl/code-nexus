import { z } from 'zod';

/** Application route validation. Shared body/query schemas come from @code-nexus/types. */
export { applicationDecisionSchema, applicationsQuerySchema } from '@code-nexus/types';

export const applicationPublicIdParam = z.object({ publicId: z.string().uuid() });
export const applyParam = z.object({ publicId: z.string().uuid() }); // drive publicId
