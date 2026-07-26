import type { RecordingStatus } from '@code-nexus/types';

/** Query keys + display helpers for the Phase 10 recordings UI. */

export const recordingKeys = {
  list: ['recordings'] as const,
  detail: (publicId: string) => ['recordings', publicId] as const,
  playback: (publicId: string) => ['recordings', publicId, 'playback'] as const,
};

export const RECORDING_STATUS_LABEL: Record<RecordingStatus, string> = {
  RECORDING: 'Recording',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
  DELETED: 'Deleted',
};

export const RECORDING_STATUS_STYLE: Record<RecordingStatus, string> = {
  RECORDING: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  PROCESSING: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  READY: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  FAILED: 'border-line bg-surface-2 text-muted',
  DELETED: 'border-line bg-surface-2 text-faint',
};

/** Human duration for a list row. */
export function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
