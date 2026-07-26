import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@code-nexus/types';
import { api, ApiError } from './api.ts';

/** The `me` payload — the SOLE authority for identity/role/status on the client. */
export interface Me {
  publicId: string;
  email: string;
  role: Role;
  status: 'PENDING_PROFILE' | 'ACTIVE' | 'SUSPENDED';
  mustResetPassword: boolean;
  permissions: string[];
}

interface AuthValue {
  me: Me | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refetch: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (err) {
        // Not logged in → null (not an error state).
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 0,
  });

  const me = data ?? null;

  const logout = async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } finally {
      qc.setQueryData(ME_QUERY_KEY, null);
      await qc.invalidateQueries();
    }
  };

  return (
    <AuthContext.Provider value={{ me, isLoading, isAuthenticated: !!me, refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Provider + hook are colocated by design (idiomatic React context module).
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
