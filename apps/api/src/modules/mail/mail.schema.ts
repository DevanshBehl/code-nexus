import { z } from 'zod';

/** Mail route validation. Shared body/query schemas come from @code-nexus/types. */
export { composeMailSchema, mailPageQuerySchema, mailContactsQuerySchema } from '@code-nexus/types';

export const mailPublicIdParam = z.object({ publicId: z.string().uuid() });
