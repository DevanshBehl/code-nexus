import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry(failureCount, error) {
        // Never retry auth/permission errors; retry transient ones a little.
        if (error instanceof ApiError && [401, 403, 400, 404].includes(error.status)) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
