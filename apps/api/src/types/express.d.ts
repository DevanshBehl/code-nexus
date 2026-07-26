import type { Logger } from '@code-nexus/logger';
import type { Role, UserStatus } from '@code-nexus/types';

// Augment Express Request with the per-request correlation id, child logger, and
// (on authenticated routes) the resolved actor + session id.
declare global {
  namespace Express {
    interface AuthContext {
      userId: string;
      publicId: string;
      role: Role;
      status: UserStatus;
      mustResetPassword: boolean;
      universityId?: string | null;
      companyId?: string | null;
    }

    interface Request {
      requestId: string;
      log: Logger;
      auth?: AuthContext;
      sessionId?: string;
    }
  }
}

export {};
