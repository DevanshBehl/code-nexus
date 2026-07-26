import { prisma } from '@code-nexus/db';
import type { Role } from '@code-nexus/types';

/**
 * The org a user is scoped to: for a UNIVERSITY login it's its own University id;
 * for a STUDENT it's the university it belongs to. Likewise COMPANY/RECRUITER.
 * Used to populate the session and to resolve ownership for `account:*`.
 */
export interface OrgScope {
  universityId: string | null;
  companyId: string | null;
}

export async function loadOrgScope(userId: string, role: Role): Promise<OrgScope> {
  switch (role) {
    case 'UNIVERSITY': {
      const uni = await prisma.university.findUnique({ where: { userId } });
      return { universityId: uni?.id ?? null, companyId: null };
    }
    case 'STUDENT': {
      const student = await prisma.student.findUnique({ where: { userId } });
      return { universityId: student?.universityId ?? null, companyId: null };
    }
    case 'COMPANY': {
      const company = await prisma.company.findUnique({ where: { userId } });
      return { universityId: null, companyId: company?.id ?? null };
    }
    case 'RECRUITER': {
      const recruiter = await prisma.recruiter.findUnique({ where: { userId } });
      return { universityId: null, companyId: recruiter?.companyId ?? null };
    }
    case 'ADMIN':
    default:
      return { universityId: null, companyId: null };
  }
}

/**
 * Load a target account (by publicId) with the org it belongs to, for ownership
 * checks on `account:reset-password | suspend | reactivate`.
 */
export async function loadTargetAccountScope(publicId: string): Promise<{
  userId: string;
  role: Role;
  universityId: string | null;
  companyId: string | null;
} | null> {
  const user = await prisma.user.findFirst({
    where: { publicId, deletedAt: null },
    include: { student: true, recruiter: true },
  });
  if (!user) return null;
  return {
    userId: user.id,
    role: user.role,
    universityId: user.student?.universityId ?? null,
    companyId: user.recruiter?.companyId ?? null,
  };
}
