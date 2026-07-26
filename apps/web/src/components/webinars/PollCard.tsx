import type { PollDto } from '@code-nexus/types';
import { CheckCircle2 } from 'lucide-react';

/**
 * A live poll card. Viewers vote once (via `onVote`); after voting — or when the
 * poll is closed — it shows aggregate result bars. Never reveals who voted. The
 * host view passes `canVote={false}` and just watches the results.
 */
export function PollCard({
  poll,
  canVote,
  onVote,
  onClose,
}: {
  poll: PollDto;
  canVote?: boolean;
  onVote?: (optionPublicId: string) => void;
  onClose?: () => void;
}) {
  const total = poll.options.reduce((n, o) => n + o.count, 0);
  const voted = poll.myVoteOptionPublicId != null;
  const closed = poll.status === 'CLOSED';
  const showResults = closed || voted || !canVote;

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-fg">{poll.question}</p>
        <span className="mono-label shrink-0 text-[9px] text-faint">
          {closed ? 'CLOSED' : 'LIVE'}
        </span>
      </div>
      <div className="space-y-2">
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.count / total) * 100) : 0;
          const mine = poll.myVoteOptionPublicId === o.publicId;
          if (showResults) {
            return (
              <div
                key={o.publicId}
                className="relative overflow-hidden rounded-lg border border-line"
              >
                <div
                  className="absolute inset-y-0 left-0 bg-accent/15"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
                <div className="relative flex items-center justify-between px-3 py-2 text-[13px]">
                  <span className="flex items-center gap-1.5 text-fg">
                    {mine ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : null}
                    {o.text}
                  </span>
                  <span className="tabular-nums text-muted">
                    {pct}% · {o.count}
                  </span>
                </div>
              </div>
            );
          }
          return (
            <button
              key={o.publicId}
              type="button"
              onClick={() => onVote?.(o.publicId)}
              className="block w-full rounded-lg border border-line-strong px-3 py-2 text-left text-[13px] text-fg hover:bg-surface-2"
            >
              {o.text}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-faint">
          {total} vote{total === 1 ? '' : 's'}
        </span>
        {onClose && !closed ? (
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-medium text-red-500 hover:underline"
          >
            Close poll
          </button>
        ) : null}
      </div>
    </div>
  );
}
