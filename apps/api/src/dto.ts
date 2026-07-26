import type { Role, UserStatus } from '@code-nexus/types';
import { permissionsForRole } from '@code-nexus/auth';

/**
 * The `me` DTO — the ONLY user shape sent to clients. Explicitly whitelisted:
 * never spread a Prisma row (which carries `passwordHash`) into a response.
 */
export interface MeDto {
  publicId: string;
  email: string;
  role: Role;
  status: UserStatus;
  mustResetPassword: boolean;
  permissions: string[];
}

export function toMeDto(user: {
  publicId: string;
  email: string;
  role: Role;
  status: UserStatus;
  mustResetPassword: boolean;
}): MeDto {
  return {
    publicId: user.publicId,
    email: user.email,
    role: user.role,
    status: user.status,
    mustResetPassword: user.mustResetPassword,
    permissions: permissionsForRole(user.role),
  };
}

/** A provisioned account, as seen in list endpoints (no secrets). */
export interface AccountDto {
  publicId: string;
  email: string;
  status: UserStatus;
  firstName: string | null;
  lastName: string | null;
}
