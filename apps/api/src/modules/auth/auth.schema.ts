import { z } from 'zod';
import { passwordPolicySchema } from '@code-nexus/auth';

export const loginSchema = z.object({
  emailOrPublicId: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Change-password body. `currentPassword` is optional because a first-login
 * user (mustResetPassword) has a valid session but is changing under duress;
 * the service enforces the rule (see auth.service).
 */
export function changePasswordSchema(minLength: number) {
  return z.object({
    currentPassword: z.string().min(1).optional(),
    newPassword: passwordPolicySchema(minLength),
  });
}
export type ChangePasswordInput = z.infer<ReturnType<typeof changePasswordSchema>>;
