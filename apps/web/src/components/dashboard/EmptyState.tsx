import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  /** Marks a feature that arrives in a later phase (honest placeholder). */
  comingIn?: string;
}

/** Honest empty state — never fabricated data (prompt_phase3.md §3.8). */
export function EmptyState({ icon: Icon = Inbox, title, hint, comingIn }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <Icon className="mb-3 h-6 w-6 text-faint" aria-hidden="true" />
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="mt-1 max-w-xs text-[13px] text-muted">{hint}</p> : null}
      {comingIn ? (
        <span className="mono-label mt-3 rounded-full border border-line px-2.5 py-1 text-[10px] text-faint">
          {comingIn}
        </span>
      ) : null}
    </div>
  );
}
