import type { ContestPhase } from '@code-nexus/types';

/** Query keys + helpers for the Phase 7 contests UI. */

export const contestKeys = {
  list: ['contests'] as const,
  detail: (publicId: string) => ['contests', publicId] as const,
  questions: (publicId: string) => ['contests', publicId, 'questions'] as const,
  leaderboard: (publicId: string) => ['contests', publicId, 'leaderboard'] as const,
  submission: (publicId: string) => ['arena', 'submission', publicId] as const,
};

export const PHASE_LABEL: Record<ContestPhase, string> = {
  draft: 'Draft',
  cancelled: 'Cancelled',
  upcoming: 'Upcoming',
  open: 'Entry open',
  running: 'In progress',
  ended: 'Ended',
};

export const PHASE_STYLE: Record<ContestPhase, string> = {
  draft: 'border-line bg-surface-2 text-muted',
  cancelled: 'border-line bg-surface-2 text-faint',
  upcoming: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  open: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  running: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ended: 'border-line bg-surface-2 text-muted',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Human countdown to (or "ended" past) a target ISO time. */
export function countdown(targetIso: string, now: number = Date.now()): string {
  let ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return '00:00:00';
  const h = Math.floor(ms / 3_600_000);
  ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  ms -= m * 60_000;
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${pad(h % 24)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}
