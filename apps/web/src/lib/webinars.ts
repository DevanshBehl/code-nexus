import type { WebinarStatus } from '@code-nexus/types';

/** Query keys + helpers for the Phase 8 webinars UI. */

export const webinarKeys = {
  list: ['webinars'] as const,
  detail: (publicId: string) => ['webinars', publicId] as const,
  messages: (publicId: string) => ['webinars', publicId, 'messages'] as const,
  polls: (publicId: string) => ['webinars', publicId, 'polls'] as const,
  attendance: (publicId: string) => ['webinars', publicId, 'attendance'] as const,
};

export const STATUS_LABEL: Record<WebinarStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  LIVE: 'Live',
  ENDED: 'Ended',
  CANCELLED: 'Cancelled',
};

export const STATUS_STYLE: Record<WebinarStatus, string> = {
  DRAFT: 'border-line bg-surface-2 text-muted',
  SCHEDULED: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  LIVE: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  ENDED: 'border-line bg-surface-2 text-muted',
  CANCELLED: 'border-line bg-surface-2 text-faint',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "2h 05m" style attended-duration label. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}m ${String(seconds % 60).padStart(2, '0')}s`;
}
