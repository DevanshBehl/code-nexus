import { z } from 'zod';

/**
 * Drive route validation. Body/query schemas are the shared contracts from
 * @code-nexus/types (single source of truth, client + server); only the URL
 * param schema is local.
 */
export { driveCreateSchema, driveUpdateSchema, applicantsQuerySchema } from '@code-nexus/types';

export const drivePublicIdParam = z.object({ publicId: z.string().uuid() });
