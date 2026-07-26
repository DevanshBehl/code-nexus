import type { Role } from '@code-nexus/types';

/**
 * The directional mailing policy (Phase 5). Who a given sender may send an
 * internal mail TO — an authorization concern, so it lives beside the RBAC
 * matrix. Deny-by-default. Receiving is unrestricted: anyone may RECEIVE from
 * anyone allowed to send to them.
 *
 * Rules (rows = sender):
 *   STUDENT    → own University + ADMIN
 *   UNIVERSITY → own Students + any COMPANY + ADMIN
 *   COMPANY    → anyone
 *   RECRUITER  → own Company + ADMIN
 *   ADMIN      → anyone
 *
 * "own" is an org-scope match: a STUDENT/UNIVERSITY match by `universityId`, a
 * RECRUITER/COMPANY by `companyId`. Self-addressing is rejected by the service,
 * not here.
 */
export interface MailParty {
  role: Role;
  universityId?: string | null; // own uni (UNIVERSITY) / belonging uni (STUDENT)
  companyId?: string | null; // own company (COMPANY) / belonging company (RECRUITER)
}

function sameUniversity(a: MailParty, b: MailParty): boolean {
  return a.universityId != null && b.universityId != null && a.universityId === b.universityId;
}

function sameCompany(a: MailParty, b: MailParty): boolean {
  return a.companyId != null && b.companyId != null && a.companyId === b.companyId;
}

export function canMail(sender: MailParty, recipient: MailParty): boolean {
  switch (sender.role) {
    case 'ADMIN':
    case 'COMPANY':
      return true; // may mail anyone
    case 'STUDENT':
      // Own university, or Code Nexus (admin).
      if (recipient.role === 'ADMIN') return true;
      if (recipient.role === 'UNIVERSITY') return sameUniversity(sender, recipient);
      return false;
    case 'UNIVERSITY':
      // Own students, any company, or admin. Never another university.
      if (recipient.role === 'ADMIN' || recipient.role === 'COMPANY') return true;
      if (recipient.role === 'STUDENT') return sameUniversity(sender, recipient);
      return false;
    case 'RECRUITER':
      // Own company, or admin.
      if (recipient.role === 'ADMIN') return true;
      if (recipient.role === 'COMPANY') return sameCompany(sender, recipient);
      return false;
    default:
      return false;
  }
}
