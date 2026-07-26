import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parse `data` with a zod schema, throwing the canonical 400 VALIDATION error. */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
      .join('; ');
    throw new AppError(400, 'VALIDATION', msg);
  }
  return result.data;
}
