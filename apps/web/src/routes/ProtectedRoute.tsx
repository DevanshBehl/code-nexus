import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@code-nexus/types';
import { ROLE_HOME } from '@code-nexus/types';
import { useAuth } from '../lib/auth.tsx';
import { FullPageSpinner } from '../components/dashboard/FullPageSpinner.tsx';

interface ProtectedRouteProps {
  children: ReactNode;
  /** If set, only this role may view; others are redirected to their own home. */
  role?: Role;
}

/**
 * Client-side guard (UX only — the server still authorizes every request):
 *  - not authenticated → /login
 *  - must reset password → /login (which shows the change-password step)
 *  - PENDING_PROFILE → /complete-profile
 *  - wrong role → that user's own home (never a hard 403 for a logged-in user)
 */
export function ProtectedRoute({ children, role }: ProtectedRouteProps) {
  const { me, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.mustResetPassword) return <Navigate to="/login" replace />;
  if (me.status === 'PENDING_PROFILE') return <Navigate to="/complete-profile" replace />;
  if (role && me.role !== role) return <Navigate to={ROLE_HOME[me.role]} replace />;

  return <>{children}</>;
}
