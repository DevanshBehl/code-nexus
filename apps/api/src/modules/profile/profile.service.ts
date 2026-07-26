import { prisma } from '@code-nexus/db';
import type {
  StudentProfileInput,
  RecruiterProfileInput,
  UniversityOrgInput,
  CompanyOrgInput,
  AdminOrgInput,
  ProfileDto,
} from '@code-nexus/types';
import { AppError } from '../../errors.js';

/** Convert a Prisma Decimal (or null) to a number (or null). */
function decToNum(d: unknown): number | null {
  if (d == null) return null;
  return typeof d === 'number' ? d : Number(d.toString());
}

/** Load the caller's own profile as a role-appropriate DTO (no secrets). */
export async function getOwnProfile(userId: string, role: string): Promise<ProfileDto> {
  const user = await prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });

  if (role === 'STUDENT') {
    const s = await prisma.student.findUniqueOrThrow({
      where: { userId },
      include: { university: true },
    });
    return {
      publicId: user.publicId,
      email: user.email,
      role: 'STUDENT',
      status: user.status,
      firstName: s.firstName,
      lastName: s.lastName,
      rollNumber: s.rollNumber,
      branch: s.branch,
      graduationYear: s.graduationYear,
      cgpa: decToNum(s.cgpa),
      phone: s.phone,
      gender: s.gender,
      dateOfBirth: s.dateOfBirth ? s.dateOfBirth.toISOString().slice(0, 10) : null,
      resumeUrl: s.resumeUrl,
      university: {
        publicId: s.university.publicId,
        name: s.university.name,
        code: s.university.code,
      },
    };
  }

  if (role === 'RECRUITER') {
    const r = await prisma.recruiter.findUniqueOrThrow({
      where: { userId },
      include: { company: true },
    });
    return {
      publicId: user.publicId,
      email: user.email,
      role: 'RECRUITER',
      status: user.status,
      firstName: r.firstName,
      lastName: r.lastName,
      designation: r.designation,
      phone: r.phone,
      company: { publicId: r.company.publicId, name: r.company.name },
    };
  }

  // Org / admin — load per-role for correct types (no unsafe casts).
  let name: string | null = null;
  let code: string | null = null;
  let website: string | null = null;

  if (role === 'UNIVERSITY') {
    const u = await prisma.university.findUniqueOrThrow({ where: { userId } });
    name = u.name;
    code = u.code;
    website = u.website;
  } else if (role === 'COMPANY') {
    const c = await prisma.company.findUniqueOrThrow({ where: { userId } });
    name = c.name;
    website = c.website;
  } else {
    const a = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId } });
    name = [a.firstName, a.lastName].filter(Boolean).join(' ') || null;
  }

  return {
    publicId: user.publicId,
    email: user.email,
    role: role as 'UNIVERSITY' | 'COMPANY' | 'ADMIN',
    status: user.status,
    name,
    code,
    website,
  };
}

/** Persist a student's profile fields. */
export async function saveStudentProfile(
  userId: string,
  input: StudentProfileInput,
): Promise<void> {
  await prisma.student.update({
    where: { userId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      rollNumber: input.rollNumber,
      branch: input.branch,
      graduationYear: input.graduationYear,
      cgpa: input.cgpa,
      phone: input.phone,
      gender: input.gender ?? null,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      resumeUrl: input.resumeUrl ?? null,
    },
  });
}

export async function saveRecruiterProfile(
  userId: string,
  input: RecruiterProfileInput,
): Promise<void> {
  await prisma.recruiter.update({
    where: { userId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      designation: input.designation,
      phone: input.phone,
    },
  });
}

/**
 * Onboarding: persist the profile for the required set and flip
 * PENDING_PROFILE → ACTIVE. Idempotent-safe: an ACTIVE user updates profile
 * without erroring (prompt_phase3.md §6). Org/Admin have no profile step.
 */
export async function completeOnboarding(
  userId: string,
  role: string,
  body: unknown,
): Promise<void> {
  if (role === 'STUDENT') {
    const { studentProfileSchema } = await import('@code-nexus/types');
    const parsed = studentProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION', formatIssues(parsed.error.issues));
    }
    await saveStudentProfile(userId, parsed.data);
  } else if (role === 'RECRUITER') {
    const { recruiterProfileSchema } = await import('@code-nexus/types');
    const parsed = recruiterProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION', formatIssues(parsed.error.issues));
    }
    await saveRecruiterProfile(userId, parsed.data);
  }
  // Flip to ACTIVE (no-op if already ACTIVE).
  await prisma.user.updateMany({
    where: { id: userId, status: 'PENDING_PROFILE', deletedAt: null },
    data: { status: 'ACTIVE' },
  });
}

export async function updateOrg(
  userId: string,
  role: string,
  input: UniversityOrgInput | CompanyOrgInput | AdminOrgInput,
): Promise<void> {
  if (role === 'UNIVERSITY') {
    const i = input as UniversityOrgInput;
    await prisma.university.update({
      where: { userId },
      data: { name: i.name, code: i.code, website: i.website ?? null },
    });
  } else if (role === 'COMPANY') {
    const i = input as CompanyOrgInput;
    await prisma.company.update({
      where: { userId },
      data: { name: i.name, website: i.website ?? null },
    });
  } else if (role === 'ADMIN') {
    const i = input as AdminOrgInput;
    await prisma.platformAdmin.update({
      where: { userId },
      data: { firstName: i.firstName ?? null, lastName: i.lastName ?? null },
    });
  } else {
    throw new AppError(403, 'FORBIDDEN', 'This role has no editable org details');
  }
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ');
}
