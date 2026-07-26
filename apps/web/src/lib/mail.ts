import type { Role } from '@code-nexus/types';

/** Query keys + small helpers for the Phase 5 mail UI. */

export const mailKeys = {
  inbox: (page: number) => ['mail', 'inbox', page] as const,
  sent: (page: number) => ['mail', 'sent', page] as const,
  detail: (publicId: string) => ['mail', 'detail', publicId] as const,
  unread: ['mail', 'unread'] as const,
  contacts: (q: string) => ['mail', 'contacts', q] as const,
};

const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  UNIVERSITY: 'University',
  COMPANY: 'Company',
  RECRUITER: 'Recruiter',
  ADMIN: 'Code Nexus',
};

export function roleLabel(role: Role): string {
  return ROLE_LABEL[role] ?? role;
}

export function formatMailTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
