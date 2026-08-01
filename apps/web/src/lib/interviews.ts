import type { InterviewStatus } from '@code-nexus/types';

/** Query keys + helpers for the Phase 9 interviews UI. */

export const interviewKeys = {
  list: ['interviews'] as const,
  detail: (publicId: string) => ['interviews', publicId] as const,
  feedback: (publicId: string) => ['interviews', publicId, 'feedback'] as const,
  bank: (publicId: string) => ['interviews', publicId, 'question-bank'] as const,
};

export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  SCHEDULED: 'Scheduled',
  LIVE: 'Live',
  ENDED: 'Ended',
  CANCELLED: 'Cancelled',
};

export const INTERVIEW_STATUS_STYLE: Record<InterviewStatus, string> = {
  SCHEDULED: 'border-info-line bg-info-soft text-info',
  LIVE: 'border-danger-line bg-danger-soft text-danger',
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

export const RECOMMENDATION_LABEL: Record<string, string> = {
  STRONG_YES: 'Strong yes',
  YES: 'Yes',
  NO: 'No',
  STRONG_NO: 'Strong no',
};
