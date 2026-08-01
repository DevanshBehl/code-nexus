import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { InlineSpinner } from './FullPageSpinner.tsx';

interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  children: ReactNode;
}

/** Standard loading / error wrapper for a data-fetching view. */
export function QueryState({ isLoading, isError, onRetry, children }: QueryStateProps) {
  if (isLoading) return <InlineSpinner />;
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertCircle className="h-5 w-5 text-danger" aria-hidden="true" />
        <p className="text-sm text-muted">Something went wrong loading this data.</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}
