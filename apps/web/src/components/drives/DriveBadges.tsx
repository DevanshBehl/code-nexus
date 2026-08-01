import type { ApplicationStatus, DriveStatus } from '@code-nexus/types';

const DRIVE_STYLES: Record<DriveStatus, string> = {
  DRAFT: 'border-line bg-surface-2 text-muted',
  OPEN: 'border-success-line bg-success-soft text-success',
  CLOSED: 'border-danger-line bg-danger-soft text-danger',
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
  APPLIED: 'border-info-line bg-info-soft text-info',
  SHORTLISTED: 'border-special-line bg-special-soft text-special',
  OFFERED: 'border-success-line bg-success-soft text-success',
  REJECTED: 'border-danger-line bg-danger-soft text-danger',
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
