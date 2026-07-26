import type { ApplicationStatus, DriveStatus } from '@code-nexus/types';

const DRIVE_STYLES: Record<DriveStatus, string> = {
  DRAFT: 'border-line bg-surface-2 text-muted',
  OPEN: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  CLOSED: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
};

const DRIVE_LABEL: Record<DriveStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  CLOSED: 'Closed',
};

export function DriveStatusBadge({ status }: { status: DriveStatus }) {
  return (
    <span
      className={`mono-label rounded-full border px-2 py-0.5 text-[9px] ${DRIVE_STYLES[status]}`}
    >
      {DRIVE_LABEL[status]}
    </span>
  );
}

const APP_STYLES: Record<ApplicationStatus, string> = {
  APPLIED: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  SHORTLISTED: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  OFFERED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  REJECTED: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  WITHDRAWN: 'border-line bg-surface-2 text-muted',
};

const APP_LABEL: Record<ApplicationStatus, string> = {
  APPLIED: 'Applied',
  SHORTLISTED: 'Shortlisted',
  OFFERED: 'Offered',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`mono-label rounded-full border px-2 py-0.5 text-[9px] ${APP_STYLES[status]}`}>
      {APP_LABEL[status]}
    </span>
  );
}
